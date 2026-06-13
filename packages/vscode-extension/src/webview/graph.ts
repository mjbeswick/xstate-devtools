// Webview bundle: ELK layout + custom bezier edge rendering.
// ELK computes node positions; all edge paths are drawn from node geometry.
import ELK from 'elkjs/lib/elk.bundled.js';
import {
    indexModel, initialConfig, enabledTransitions, fire, isDone,
    SimIndex, SimModel, SimTransition,
} from '../machineModel';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface NodeData {
    id: string; label: string; name: string;
    parent?: string; initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
    history?: 'shallow' | 'deep'; ghost?: boolean;
    entryActions?: string[]; exitActions?: string[]; internalTransitions?: string[];
    invokes?: string[]; description?: string;
}
interface GraphPayload {
    nodes: { data: NodeData }[];
    edges: { data: { id: string; source: string; target: string; label: string } }[];
    collapsedIds?: string[];
    sim?: SimModel;
}
interface XY { x: number; y: number }
interface ElkEdgeLabel { text?: string; width?: number; height?: number; x?: number; y?: number }
interface ElkEdge {
    id: string; sources: string[]; targets: string[];
    labels?: ElkEdgeLabel[];
    sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[];
}
interface ElkNode {
    id: string; width?: number; height?: number; x?: number; y?: number;
    labels?: { text: string; width?: number; height?: number; x?: number; y?: number; layoutOptions?: Record<string, string> }[];
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?: ElkEdge[];
}

// Per-routed-edge metadata, populated by buildElkGraph and read while drawing.
const edgeMeta = new Map<string, { srcId: string; tgtId: string; lines: string[] }>();

const SVGNS = 'http://www.w3.org/2000/svg';
const vscode = acquireVsCodeApi();
// Mutable so the host can push a fresh model (on source edit / tree expansion)
// via a `setModel` message without reloading the whole webview — which would
// destroy the user's pan/zoom.
let payload: GraphPayload = (window as unknown as { __GRAPH__: GraphPayload }).__GRAPH__;
const elk = new ELK();

// Layout flow direction, toggled from the toolbar. 'DOWN' = top-to-bottom,
// 'RIGHT' = left-to-right. Edge routing adapts via per-side outward normals.
// Initialised from the host (persisted per panel, so it survives refreshes).
let direction: 'DOWN' | 'RIGHT' =
    (window as unknown as { __DIRECTION__?: string }).__DIRECTION__ === 'RIGHT' ? 'RIGHT' : 'DOWN';

// Sanitized state name to auto-select on first render (set when the panel is
// opened from a specific tree or editor node).
const initialSelect = (window as unknown as { __SELECT__?: string }).__SELECT__ || '';
// Whether internal (action-only) transition rows show inside state boxes. Seeded
// from the `showInternalTransitions` setting; toggled live from the toolbar.
let showInternal = (window as unknown as { __SHOWINTERNAL__?: boolean }).__SHOWINTERNAL__ !== false;
const internalRows = (d: NodeData): string[] => (showInternal ? d.internalTransitions ?? [] : []);

// ── Theme ─────────────────────────────────────────────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const bodyStyle  = getComputedStyle(document.body);
function themeVar(name: string, fallback: string): string {
    return (rootStyle.getPropertyValue(name) || bodyStyle.getPropertyValue(name)).trim() || fallback;
}
const C = {
    fg:     themeVar('--vscode-editor-foreground',              '#1f1f1f'),
    bg:     themeVar('--vscode-editor-background',              '#ffffff'),
    nodeBg: themeVar('--vscode-editorWidget-background',        '#f3f3f3'),
    focus:  themeVar('--vscode-focusBorder',                    '#0090f1'),
    selBg:  themeVar('--vscode-list-activeSelectionBackground', '#cce5ff'),
    desc:   themeVar('--vscode-descriptionForeground',          '#717171'),
    accent: themeVar('--vscode-charts-blue',                    '#3b82f6'),
    // State-kind accents. The final-state double ring uses the neutral
    // foreground colour (a red ring reads as an error); parallel uses blue. The
    // initial dot uses the foreground colour (the Harel solid black dot — black
    // on light themes, adapting to white on dark).
    stFinal:    themeVar('--vscode-editor-foreground', '#1f1f1f'),
    stParallel: themeVar('--vscode-charts-blue',       '#3b82f6'),
    // Simulator: the currently-active state configuration.
    simActive:  themeVar('--vscode-charts-green',  '#388a34'),
};
const fontFamily = themeVar('--vscode-font-family', 'system-ui, sans-serif');

const measureCtx = document.createElement('canvas').getContext('2d')!;
function textW(s: string, px: number, weight = 'normal'): number {
    measureCtx.font = `${weight} ${px}px ${fontFamily}`;
    return measureCtx.measureText(s).width;
}
// Ellipsize `s` to fit `maxW` px. Returns the (possibly truncated) text and
// whether it was clipped (so the caller can attach a full-text tooltip).
function clip(s: string, px: number, maxW: number, weight = 'normal'): { text: string; clipped: boolean } {
    if (textW(s, px, weight) <= maxW) { return { text: s, clipped: false }; }
    let lo = 0, hi = s.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (textW(s.slice(0, mid) + '…', px, weight) <= maxW) { lo = mid; } else { hi = mid - 1; }
    }
    return { text: s.slice(0, lo) + '…', clipped: true };
}

// ── Sizing constants ──────────────────────────────────────────────────────────
const LABEL_PX      = 13;
const ACTION_PX     = 11;
const ACTION_LINE_H = 15;
const ACTION_TOP    = 7;
const NODE_V_PAD    = 10;
const REGION_H      = 28;
const MIN_W         = 110;
const MAX_W         = 320; // cap so one long action/event name can't blow up layout

function nw(label: string, entry: string[], exit: string[], internal: string[] = []): number {
    // Title is rendered at LABEL_PX (13) and centred; actions at ACTION_PX (11)
    // and left-aligned. Measure each row at its real size + generous side pad.
    // Internal transitions are already-formatted `EVENT [guard] / actions` rows.
    const titleW = Math.ceil(textW(label, LABEL_PX, '500')) + 32;
    const actionW = [...entry.map(a => `entry / ${a}`), ...exit.map(a => `exit / ${a}`), ...internal]
        .map(l => Math.ceil(textW(l, ACTION_PX)) + 24);
    // Cap the width; rows wider than the cap are ellipsized at draw time.
    return Math.min(MAX_W, Math.max(MIN_W, titleW, ...actionW));
}
function nh(entry: string[], exit: string[], internal: string[] = []): number {
    const n = entry.length + exit.length + internal.length;
    return n === 0
        ? NODE_V_PAD * 2 + LABEL_PX + 4
        : NODE_V_PAD * 2 + LABEL_PX + 4 + 1 + ACTION_TOP + n * ACTION_LINE_H + 4;
}

// ── Data indexes ──────────────────────────────────────────────────────────────
// Rebuilt from `payload` on load and on every `setModel` push.
const nodeById = new Map<string, NodeData>();
const childrenOf = new Map<string, string[]>();
const collapsed = new Set<string>();
function loadModel(p: GraphPayload): void {
    nodeById.clear(); childrenOf.clear(); collapsed.clear();
    for (const n of p.nodes) { nodeById.set(n.data.id, n.data); }
    for (const n of p.nodes) {
        const k = n.data.parent ?? '__root__';
        childrenOf.set(k, [...(childrenOf.get(k) ?? []), n.data.id]);
    }
    for (const id of p.collapsedIds ?? []) { collapsed.add(id); }
    simIndex = p.sim ? indexModel(p.sim) : null;
}
let simIndex: SimIndex | null = null;
loadModel(payload);
const childStateIds = (id: string) =>
    (childrenOf.get(id) ?? []).filter(cid => !nodeById.get(cid)?.start);

function visibleEndpoint(id: string): string {
    const chain: string[] = [];
    let cur: string | undefined = id;
    while (cur) { chain.unshift(cur); cur = nodeById.get(cur)?.parent; }
    for (const c of chain) { if (collapsed.has(c)) { return c; } }
    return id;
}

// ── ELK graph ─────────────────────────────────────────────────────────────────
function buildElkNode(id: string): ElkNode {
    const d = nodeById.get(id)!;
    if (d.start) { return { id, width: 14, height: 14 }; }
    if (d.history) { return { id, width: 30, height: 30 }; }
    const states = childStateIds(id);
    const isRegion = states.length > 0 && !collapsed.has(id);
    if (!isRegion) {
        // Collapsed parents get a left-anchored '+' toggle square, drawn at render
        // time; the title's clip width is narrowed there to leave room for it.
        const display = d.label;
        // Compartment rows below the title: internal transitions + invoked services.
        const extraRows = [...internalRows(d), ...(d.invokes ?? []).map(s => `invoke ${s}`)];
        return {
            id,
            width:  nw(display, d.entryActions ?? [], d.exitActions ?? [], extraRows),
            height: nh(d.entryActions ?? [], d.exitActions ?? [], extraRows),
            labels: [{ text: d.label }],
        };
    }
    return {
        id,
        labels: [{
            text: d.label,
            width: Math.ceil(textW(d.label, 12, 'bold')),
            height: 16,
            layoutOptions: { 'elk.nodeLabels.placement': 'H_CENTER V_TOP INSIDE' },
        }],
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': direction,
            ...ROUTING_OPTS,
            'elk.padding': `[top=${REGION_H + 6},left=18,bottom=14,right=18]`,
        },
        children: (childrenOf.get(id) ?? []).map(buildElkNode),
    };
}

// Shared routing/spacing options applied at every hierarchy level so ELK
// routes edges (avoiding nodes, spacing parallels) and places their labels in
// free space instead of us stacking them at curve midpoints.
const ROUTING_OPTS: Record<string, string> = {
    'elk.edgeRouting': 'ORTHOGONAL',
    // Base spacing is kept tight — ELK adds its own room for the reserved edge
    // labels on top of this, so a large base would double up.
    'elk.layered.spacing.nodeNodeBetweenLayers': '36',
    'elk.spacing.nodeNode': '26',
    'elk.spacing.edgeNode': '12',
    'elk.spacing.edgeEdge': '8',
    'elk.layered.spacing.edgeNodeBetweenLayers': '12',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
    // Give ELK the labels so it reserves space and places them in gaps,
    // spreading nodes apart rather than letting labels pile onto each other.
    'elk.edgeLabels.placement': 'CENTER',
    'elk.spacing.edgeLabel': '3',
    'elk.layered.thoroughness': '12',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
};

function buildElkGraph(): ElkNode {
    edgeMeta.clear();
    // Merge transitions sharing a visible source→target pair into one routed
    // edge (skip self-loops and initial-marker edges — drawn separately).
    const merged = new Map<string, { id: string; s: string; t: string; lines: string[] }>();
    const startEdges: ElkEdge[] = [];
    for (const e of payload.edges) {
        const s = visibleEndpoint(e.data.source), t = visibleEndpoint(e.data.target);
        if (s === t) { continue; }
        if (e.data.source.startsWith('start_')) {
            // Let ELK route the initial-state arrows too, so they connect the
            // dot to the state cleanly instead of at an arbitrary angle.
            startEdges.push({ id: e.data.id, sources: [s], targets: [t] });
            continue;
        }
        const key = `${s} ${t}`;
        const lines = e.data.label ? e.data.label.split('\n').filter(Boolean) : [];
        const ex = merged.get(key);
        if (ex) { for (const l of lines) { if (!ex.lines.includes(l)) { ex.lines.push(l); } } }
        else { merged.set(key, { id: e.data.id, s, t, lines: [...lines] }); }
    }
    const edges: ElkEdge[] = [...startEdges];
    for (const m of merged.values()) {
        edgeMeta.set(m.id, { srcId: m.s, tgtId: m.t, lines: m.lines });
        const labels: ElkEdgeLabel[] = m.lines.length ? [{
            text: m.lines.join('\n'),
            width: Math.max(...m.lines.map(l => Math.ceil(textW(l, ACTION_PX)))) + 12,
            height: m.lines.length * ACTION_LINE_H + 4,
        }] : [];
        edges.push({ id: m.id, sources: [m.s], targets: [m.t], labels });
    }
    return {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': direction,
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            ...ROUTING_OPTS,
        },
        children: (childrenOf.get('__root__') ?? []).map(buildElkNode),
        edges,
    };
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) { n.setAttribute(k, String(v)); }
    return n;
}
function txt(s: string, x: number, y: number, attrs: Record<string, string | number> = {}): SVGElement {
    const t = el('text', { x, y, 'font-family': fontFamily, fill: C.fg, ...attrs });
    t.textContent = s;
    return t;
}
// Like txt(), but ellipsizes `full` to `maxW` px and attaches a full-text
// <title> tooltip when truncated. `px`/`weight` must match the rendered font.
function clipTxt(full: string, x: number, y: number, maxW: number, px: number, attrs: Record<string, string | number> = {}, weight = 'normal'): SVGElement {
    const c = clip(full, px, maxW, weight);
    const t = txt(c.text, x, y, attrs);
    if (c.clipped) { const ti = el('title'); ti.textContent = full; t.appendChild(ti); }
    return t;
}
// A small rounded-square +/− toggle, mirroring the toolbar's expand/collapse
// icons. Drawn (not a glyph) so the +/− sits inset from the border with padding.
// `kind`: 'plus' = collapsed (click to expand), 'minus' = expanded (click to
// collapse). Centred on (cx, cy).
function toggleSquare(cx: number, cy: number, kind: 'plus' | 'minus'): SVGElement {
    const S = 11, r = S / 2, pad = 3, a = r - pad;
    const g = el('g');
    g.appendChild(el('rect', {
        x: cx - r, y: cy - r, width: S, height: S, rx: 2.5, ry: 2.5,
        fill: 'none', stroke: C.desc, 'stroke-width': 1.1,
    }));
    g.appendChild(el('line', { x1: cx - a, y1: cy, x2: cx + a, y2: cy, stroke: C.desc, 'stroke-width': 1.1 }));
    if (kind === 'plus') {
        g.appendChild(el('line', { x1: cx, y1: cy - a, x2: cx, y2: cy + a, stroke: C.desc, 'stroke-width': 1.1 }));
    }
    return g;
}

// ── Viewport ──────────────────────────────────────────────────────────────────
type Rect = { x: number; y: number; w: number; h: number };
const geom = new Map<string, Rect>();
// Sanitized state name → node id, so the host's cursor-sync `highlight` message
// (keyed by name) can drive the same selection as keyboard nav (keyed by id).
const idByName = new Map<string, string>();
const container = document.getElementById('cy')!;
let viewport: SVGElement;
let scale = 1, tx = 0, ty = 0;
// While true, the diagram keeps re-fitting on container resize. The webview
// panel often keeps resizing for a few frames after it opens (editor-column
// animation), so a one-shot fit can lock onto a transient, too-small viewport
// and strand the diagram in a corner. Any manual pan/zoom turns this off.
let autoFit = true;
let lastW = 100, lastH = 100;

// Keyboard navigation: the currently-selected state, and the primary shape for
// every node id so selection can restyle the node itself (VS Code selection
// colours) rather than overlay a ring. Container is focusable for keydown.
container.tabIndex = 0;
(container as HTMLElement).style.outline = 'none';
let selectedId: string | null = null;
// Whether the current selection shows the hover-style focus effect (connected
// edges emphasized, the rest dimmed). Set for explicit in-diagram selection
// (keyboard/click), but not passive cursor-sync or first-open selection.
let emphasized = false;
const nodeRectById = new Map<string, SVGElement>();

// Edge index for the hover/selection focus effect — rebuilt each render(), but
// declared at module scope so keyboard/click selection (module-level functions)
// can drive the same emphasis as hover.
interface EdgeEntry { path: SVGElement; labelG: SVGElement | null }
let allEdges: EdgeEntry[] = [];
let nodeEdgeMap = new Map<string, EdgeEntry[]>();

function resetEdgeStyles() {
    for (const { path, labelG } of allEdges) {
        path.setAttribute('stroke-opacity', '0.7');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('opacity', '1');  // clear any dim
        if (labelG) { labelG.setAttribute('opacity', '1'); }
    }
}
// Emphasize a node's connected edges and dim the rest — the focus effect shared
// by hover and selection.
function emphasizeNode(id: string) {
    const mine = new Set(nodeEdgeMap.get(id) ?? []);
    for (const e of allEdges) {
        if (mine.has(e)) {
            e.path.setAttribute('opacity', '1');
            e.path.setAttribute('stroke-opacity', '0.95');
            e.path.setAttribute('stroke-width', '2');
        } else {
            // Fade element opacity (not just stroke-opacity) so the arrowhead
            // marker dims with the line instead of staying solid.
            e.path.setAttribute('opacity', '0.12');
            if (e.labelG) { e.labelG.setAttribute('opacity', '0.15'); }
        }
    }
}
// Reset all edges, then re-assert the selected node's emphasis — so hovering
// away from a state restores the selection's focus effect instead of clearing it.
function refreshEdgeEmphasis() {
    resetEdgeStyles();
    if (emphasized && selectedId) { emphasizeNode(selectedId); }
}

const zoomReadout = document.getElementById('btn-zoom-reset');
function applyTransform() {
    viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
    if (zoomReadout) { zoomReadout.textContent = `${Math.round(scale * 100)}%`; }
}

// ── Eased transform animation ───────────────────────────────────────────────
// Programmatic transform changes (fit, zoom buttons, pan-to-node, recenter)
// ease to their target; direct manipulation (wheel/drag) stays instant and
// cancels any running animation via cancelAnim().
let animId = 0;
function cancelAnim() { if (animId) { cancelAnimationFrame(animId); animId = 0; } }
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
function animateTo(ntx: number, nty: number, ns: number, dur = 240): void {
    cancelAnim();
    const sx = tx, sy = ty, ss = scale, t0 = performance.now();
    const tick = (now: number) => {
        const e = easeOutCubic(Math.min(1, (now - t0) / dur));
        tx = sx + (ntx - sx) * e;
        ty = sy + (nty - sy) * e;
        scale = ss + (ns - ss) * e;
        applyTransform();
        animId = e < 1 ? requestAnimationFrame(tick) : 0;
    };
    animId = requestAnimationFrame(tick);
}

// Reset to 100% (actual size), keeping the viewport centre fixed.
function actualSize() {
    autoFit = false;
    const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
    animateTo(cx - ((cx - tx) / scale), cy - ((cy - ty) / scale), 1);
}
// The transform that fits the whole diagram, centred (no side effects).
function fitTarget(): { tx: number; ty: number; scale: number } {
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const s = Math.min(cw / lastW, ch / lastH, 1.5) * 0.92 || 1;
    return { tx: (cw - lastW * s) / 2, ty: (ch - lastH * s) / 2, scale: s };
}
// Instant fit — used by the auto-fit resize observer and the initial paint,
// where the panel is still settling and a per-frame tween would be janky.
function fitToScreen() {
    cancelAnim();
    const t = fitTarget();
    tx = t.tx; ty = t.ty; scale = t.scale;
    applyTransform();
}
// Explicit user-driven fit (button / keyboard): ease there and resume auto-fit.
function fitNow() { autoFit = true; const t = fitTarget(); animateTo(t.tx, t.ty, t.scale); }
// Re-render after a collapse/expand and, if the user hasn't taken manual control
// of the view (autoFit still on), ease back to a centred fit so a big subtree
// collapsing/expanding doesn't strand the diagram off to one side.
function rerenderCollapse(): void {
    render().then(() => {
        if (autoFit) { const t = fitTarget(); animateTo(t.tx, t.ty, t.scale); }
    }).catch(showError);
}
// Fit as soon as the container has a real size, and keep re-fitting on every
// resize until the user takes control (`autoFit`). At first paint clientWidth
// can still be 0 (webview layout not settled) and the panel can keep growing for
// several frames after opening — a one-shot fit would mis-centre against the
// transient size, so we stay subscribed.
function fitWhenReady() {
    if (container.clientWidth > 0 && container.clientHeight > 0) { fitToScreen(); }
    const ro = new ResizeObserver(() => {
        if (autoFit && container.clientWidth > 0 && container.clientHeight > 0) { fitToScreen(); }
    });
    ro.observe(container);
}

// ── Render ────────────────────────────────────────────────────────────────────
// `fit: true` re-fits the diagram to the viewport (first open, fit button,
// direction change). Otherwise the user's current pan/zoom is preserved across
// the rebuild — collapse/expand and live model updates must not yank the view.
async function render(opts: { fit?: boolean } = {}): Promise<void> {
    // Call as a method so elkjs keeps its `this` binding; cast the argument
    // through unknown since our ElkNode shape differs from elkjs's typings.
    const graph = buildElkGraph() as unknown as Parameters<typeof elk.layout>[0];
    const result = await elk.layout(graph) as unknown as ElkNode;
    lastW = result.width ?? 100;
    lastH = result.height ?? 100;

    container.replaceChildren();
    idByName.clear();
    nodeRectById.clear();
    geom.clear();

    const svg = el('svg', { width: '100%', height: '100%' });
    const defs = el('defs');
    const arrowMk = el('marker', {
        id: 'arr', viewBox: '0 0 8 8', refX: 7, refY: 4,
        markerWidth: 6, markerHeight: 6, orient: 'auto',
    });
    arrowMk.appendChild(el('path', { d: 'M 0 1 L 7 4 L 0 7 Z', fill: C.fg }));
    defs.appendChild(arrowMk);
    svg.appendChild(defs);

    viewport = el('g');
    const gBack   = el('g'); // region backgrounds
    const gEdges  = el('g'); // edge paths
    const gNodes  = el('g'); // leaf state boxes
    const gLabels = el('g'); // edge labels (topmost)
    viewport.append(gBack, gEdges, gNodes, gLabels);
    svg.appendChild(viewport);
    container.appendChild(svg);

    // ── Pass 1: absolute geometry for all nodes ───────────────────────────
    const collectGeom = (n: ElkNode, ox: number, oy: number) => {
        const ax = ox + (n.x ?? 0), ay = oy + (n.y ?? 0);
        if (n.id !== 'root') { geom.set(n.id, { x: ax, y: ay, w: n.width ?? 0, h: n.height ?? 0 }); }
        for (const c of n.children ?? []) { collectGeom(c, ax, ay); }
    };
    collectGeom(result, 0, 0);

    // Per-node edge lists populated during edge drawing — closures in drawNode
    // read these after edge drawing completes. Reset the module-level index each
    // render so selection/hover emphasis operates on the current edges.
    allEdges = [];
    nodeEdgeMap = new Map<string, EdgeEntry[]>();
    function registerEdge(srcId: string, tgtId: string, entry: EdgeEntry) {
        allEdges.push(entry);
        for (const id of [srcId, tgtId]) {
            const arr = nodeEdgeMap.get(id) ?? [];
            arr.push(entry);
            nodeEdgeMap.set(id, arr);
        }
    }

    // ── Pass 2: draw nodes ────────────────────────────────────────────────
    const drawNode = (n: ElkNode, ox: number, oy: number) => {
        const ax = ox + (n.x ?? 0), ay = oy + (n.y ?? 0);
        if (n.id !== 'root') {
            const d = nodeById.get(n.id)!;
            const w = n.width ?? 0, h = n.height ?? 0;
            const isCollapsed = collapsed.has(n.id);
            const hasChildren = childStateIds(n.id).length > 0;
            const isRegion = hasChildren && !isCollapsed;
            const g = el('g', {
                'data-id': n.id,
                'data-kind': isRegion ? 'region' : d.start ? 'start' : 'state',
                'data-name': d.name,
            });
            (g as SVGElement).style.cursor = 'pointer';
            // Native tooltip from the state's `description`.
            if (d.description) {
                const title = el('title');
                title.textContent = d.description;
                g.appendChild(title);
            }

            if (d.start) {
                g.appendChild(el('circle', { cx: ax + w/2, cy: ay + h/2, r: 6, fill: C.fg }));
                gNodes.appendChild(g);
            } else if (d.history) {
                // History pseudostate: circle with H (shallow) or H* (deep).
                const cxp = ax + w/2, cyp = ay + h/2;
                const histCircle = el('circle', { cx: cxp, cy: cyp, r: w/2 - 1, fill: C.nodeBg, stroke: C.fg, 'stroke-width': 1.5, 'stroke-opacity': 0.8 });
                g.appendChild(histCircle);
                g.appendChild(txt(d.history === 'deep' ? 'H*' : 'H', cxp, cyp, { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 13, 'font-weight': 'bold' }));
                idByName.set(d.name, n.id);
                nodeRectById.set(n.id, histCircle);
                gNodes.appendChild(g);
            } else if (isRegion) {
                const isParallel = !!d.parallel;
                // Regions are outline-only: translucent fills stack on deep
                // nesting and turn muddy, so let the border + title bar define
                // them. Parallel-ness reads from the dashed border + tag.
                const regionRect = el('rect', {
                    x: ax, y: ay, width: w, height: h, rx: 14, ry: 14,
                    fill: 'none',
                    stroke: isParallel ? C.stParallel : C.fg,
                    'stroke-width': isParallel ? 1.6 : 1.5,
                    'stroke-opacity': isParallel ? 0.85 : 0.6,
                    ...(isParallel ? { 'stroke-dasharray': '7 4' } : {}),
                });
                g.appendChild(regionRect);
                nodeRectById.set(n.id, regionRect);
                g.appendChild(el('line', {
                    x1: ax+1, y1: ay+REGION_H, x2: ax+w-1, y2: ay+REGION_H,
                    stroke: C.fg, 'stroke-width': 0.75, 'stroke-opacity': 0.35,
                }));
                // Left-anchored minus square marks the header as collapsible.
                g.appendChild(toggleSquare(ax+13, ay+REGION_H/2, 'minus'));
                g.appendChild(clipTxt(d.label, ax+w/2, ay+REGION_H-9, w-56, 12, {
                    'text-anchor': 'middle', 'font-size': 12, 'font-weight': 'bold',
                }, 'bold'));
                if (isParallel) {
                    // Plain "parallel" tag, right-aligned in the title bar.
                    g.appendChild(txt('parallel', ax+w-8, ay+REGION_H-9, {
                        'text-anchor': 'end', 'font-size': 10, fill: C.desc, 'font-style': 'italic',
                    }));
                }
                // Collapsing toggles on the title bar only — clicking the empty
                // body would too easily collapse a region while reaching for a
                // child. A transparent hit-rect over the header (drawn on top, so
                // it wins over the title text) is the toggle target; the body
                // itself shows a default cursor.
                (g as SVGElement).style.cursor = 'default';
                const header = el('rect', {
                    x: ax, y: ay, width: w, height: REGION_H,
                    fill: 'transparent', 'pointer-events': 'all',
                });
                (header as SVGElement).style.cursor = 'pointer';
                g.appendChild(header);
                // Hover: highlight connected edges (closure reads nodeEdgeMap after fill)
                g.addEventListener('mouseenter', () => {
                    regionRect.setAttribute('stroke-width', '2');
                    regionRect.setAttribute('stroke-opacity', '0.9');
                    emphasizeNode(n.id);
                });
                const restW = isParallel ? '1.6' : '1.5';
                const restO = isParallel ? '0.75' : '0.6';
                g.addEventListener('mouseleave', () => {
                    regionRect.setAttribute('stroke-width', restW);
                    regionRect.setAttribute('stroke-opacity', restO);
                    applyNodeStyle(n.id);  // re-assert selection colours if selected
                    refreshEdgeEmphasis();  // restore the selected node's emphasis, if any
                });
                gBack.appendChild(g);
            } else if (d.ghost) {
                // Exit stub: a transition target outside the focused subtree.
                const ghostRect = el('rect', {
                    x: ax, y: ay, width: w, height: h, rx: 8, ry: 8,
                    fill: 'none', stroke: C.fg, 'stroke-width': 1.2,
                    'stroke-opacity': 0.45, 'stroke-dasharray': '4 4',
                });
                g.appendChild(ghostRect);
                nodeRectById.set(n.id, ghostRect);
                g.appendChild(txt('→ ' + d.label, ax + w/2, ay + h/2, {
                    'text-anchor': 'middle', 'dominant-baseline': 'central',
                    'font-size': 11, 'font-style': 'italic', fill: C.desc,
                }));
                gNodes.appendChild(g);
            } else {
                const isParallel = !!d.parallel; // a collapsed parallel state
                const rect = el('rect', {
                    x: ax, y: ay, width: w, height: h, rx: 8, ry: 8,
                    fill: C.nodeBg, 'fill-opacity': 1,
                    stroke: isParallel ? C.stParallel : C.fg,
                    'stroke-width': isParallel ? 1.6 : 1.5,
                    'stroke-opacity': isParallel ? 0.85 : 0.8,
                    ...(isParallel ? { 'stroke-dasharray': '7 4' } : {}),
                });
                idByName.set(d.name, n.id);
                nodeRectById.set(n.id, rect);
                g.appendChild(rect);
                if (d.final) {
                    g.appendChild(el('rect', {
                        x: ax+4, y: ay+4, width: w-8, height: h-8,
                        rx: 5, ry: 5, fill: 'none',
                        stroke: C.stFinal, 'stroke-width': 1.25, 'stroke-opacity': 0.85,
                    }));
                }
                const entry = d.entryActions ?? [];
                const exit  = d.exitActions  ?? [];
                const internal = internalRows(d);
                const invokes = d.invokes ?? [];
                const collapsedToggle = isCollapsed && hasChildren;
                const label = d.label;
                const titleW = collapsedToggle ? w - 40 : w - 16;  // leave room for the left '+' toggle
                if (entry.length > 0 || exit.length > 0 || internal.length > 0 || invokes.length > 0) {
                    const labelY = ay + NODE_V_PAD + LABEL_PX;
                    g.appendChild(clipTxt(label, ax+w/2, labelY, titleW, LABEL_PX, {
                        'text-anchor': 'middle', 'font-size': LABEL_PX, 'font-weight': '500',
                    }, '500'));
                    if (collapsedToggle) { g.appendChild(toggleSquare(ax+13, labelY - LABEL_PX/2 + 1, 'plus')); }
                    const divY = labelY + NODE_V_PAD / 2;
                    g.appendChild(el('line', {
                        x1: ax+1, y1: divY, x2: ax+w-1, y2: divY,
                        stroke: C.fg, 'stroke-width': 0.6, 'stroke-opacity': 0.3,
                    }));
                    let lineY = divY + ACTION_TOP + ACTION_PX;
                    for (const a of entry) {
                        g.appendChild(clipTxt(`entry / ${a}`, ax+8, lineY, w-16, ACTION_PX, { 'font-size': ACTION_PX, fill: C.desc }));
                        lineY += ACTION_LINE_H;
                    }
                    for (const a of exit) {
                        g.appendChild(clipTxt(`exit / ${a}`, ax+8, lineY, w-16, ACTION_PX, { 'font-size': ACTION_PX, fill: C.desc }));
                        lineY += ACTION_LINE_H;
                    }
                    // Internal transitions: event-triggered actions with no state
                    // change. Already formatted `EVENT [guard] / actions`; the
                    // event name reads in the foreground colour to stand apart
                    // from entry/exit rows.
                    for (const line of internal) {
                        g.appendChild(clipTxt(line, ax+8, lineY, w-16, ACTION_PX, { 'font-size': ACTION_PX, fill: C.fg, 'fill-opacity': 0.85 }));
                        lineY += ACTION_LINE_H;
                    }
                    // Invoked services: `invoke <src>`, italic to read as an activity.
                    for (const src of invokes) {
                        g.appendChild(clipTxt(`invoke ${src}`, ax+8, lineY, w-16, ACTION_PX, { 'font-size': ACTION_PX, fill: C.desc, 'font-style': 'italic' }));
                        lineY += ACTION_LINE_H;
                    }
                } else {
                    g.appendChild(clipTxt(label, ax+w/2, ay + h/2 + LABEL_PX/2 - 1, titleW, LABEL_PX, {
                        'text-anchor': 'middle', 'font-size': LABEL_PX, 'font-weight': '500',
                    }, '500'));
                    if (collapsedToggle) { g.appendChild(toggleSquare(ax+13, ay + h/2, 'plus')); }
                }
                // Hover: highlight connected edges + thicken border
                g.addEventListener('mouseenter', () => {
                    rect.setAttribute('stroke-width', '2');
                    rect.setAttribute('stroke-opacity', '1');
                    emphasizeNode(n.id);
                });
                g.addEventListener('mouseleave', () => {
                    applyNodeStyle(n.id);  // restore default or selection colours
                    refreshEdgeEmphasis();  // restore the selected node's emphasis, if any
                });
                gNodes.appendChild(g);
            }
        }
        for (const c of n.children ?? []) { drawNode(c, ax, ay); }
    };
    drawNode(result, 0, 0);

    // ── Self-transitions: kept aside, drawn as corner loops below ─────────
    const selfEdges = new Map<string, string>();  // nodeId → merged label
    for (const e of payload.edges) {
        if (e.data.source.startsWith('start_')) { continue; }
        // Only a GENUINE self-transition (same state at both ends) draws a loop.
        // A transition between two distinct descendants of a collapsed state
        // also lands on one node (both map to the collapsed box), but it is
        // internal to the hidden subtree and must stay hidden — otherwise every
        // internal event piles into one giant self-loop label beside the node.
        if (e.data.source !== e.data.target) { continue; }
        // And skip it if the state itself is hidden inside a collapsed ancestor
        // (don't bubble a descendant's self-loop up onto the collapsed box).
        const id = e.data.source;
        if (visibleEndpoint(id) !== id) { continue; }
        const lbl = e.data.label.trim();
        const prev = selfEdges.get(id);
        selfEdges.set(id, prev ? (lbl ? `${prev}\n${lbl}` : prev) : lbl);
    }

    // Drop near-duplicate and near-collinear points so corner-rounding doesn't
    // turn ELK's tiny routing jogs into visible squiggles near the arrowhead.
    const simplify = (p: XY[]): XY[] => {
        const dedup: XY[] = [];
        for (const pt of p) {
            const last = dedup[dedup.length - 1];
            if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 2) { continue; }
            dedup.push(pt);
        }
        if (dedup.length <= 2) { return dedup; }
        const out: XY[] = [dedup[0]];
        for (let i = 1; i < dedup.length - 1; i++) {
            const a = dedup[i - 1], b = dedup[i], c = dedup[i + 1];
            const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            if (Math.abs(cross) / len < 2) { continue; } // ~collinear → skip b
            out.push(b);
        }
        out.push(dedup[dedup.length - 1]);
        return out;
    };

    // Point on a rectangle's border along the ray from its centre toward `to`.
    const borderPoint = (rect: Rect, to: XY): XY => {
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        const dx = to.x - cx, dy = to.y - cy;
        if (dx === 0 && dy === 0) { return { x: cx, y: cy }; }
        const tx = dx !== 0 ? (rect.w / 2) / Math.abs(dx) : Infinity;
        const ty = dy !== 0 ? (rect.h / 2) / Math.abs(dy) : Infinity;
        const k = Math.min(tx, ty);
        return { x: cx + dx * k, y: cy + dy * k };
    };

    // Smooth a routed polyline by rounding every corner uniformly with a
    // quadratic curve (radius capped at half the shorter adjacent segment so
    // curves never overshoot). Uniform treatment avoids the sharp kink that a
    // special-cased final corner produced.
    const roundedPath = (p: XY[], r: number): string => {
        if (p.length < 2) { return ''; }
        if (p.length === 2) { return `M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y}`; }
        let d = `M ${p[0].x} ${p[0].y}`;
        for (let i = 1; i < p.length - 1; i++) {
            const a = p[i - 1], c = p[i], b = p[i + 1];
            const d1 = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            const d2 = Math.hypot(b.x - c.x, b.y - c.y) || 1;
            const rr = Math.min(r, d1 / 2, d2 / 2);
            const ix = c.x + (a.x - c.x) / d1 * rr, iy = c.y + (a.y - c.y) / d1 * rr;
            const ox = c.x + (b.x - c.x) / d2 * rr, oy = c.y + (b.y - c.y) / d2 * rr;
            d += ` L ${ix} ${iy} Q ${c.x} ${c.y} ${ox} ${oy}`;
        }
        const last = p[p.length - 1];
        d += ` L ${last.x} ${last.y}`;
        return d;
    };

    // ── Collect ELK-routed edges (sections live on their container node) ──
    interface Routed { id: string; pts: XY[]; label?: XY }
    const routed: Routed[] = [];
    // elkjs keeps every edge on root.edges, but its section coordinates are
    // relative to the lowest common ancestor of the two endpoints — so offset
    // each edge by that ancestor's absolute position (root → no offset).
    const lcaOffset = (s: string, t: string): XY => {
        const anc = new Set<string>();
        for (let c: string | undefined = s; c; c = nodeById.get(c)?.parent) { anc.add(c); }
        let c: string | undefined = t;
        while (c && !anc.has(c)) { c = nodeById.get(c)?.parent; }
        const g = c ? geom.get(c) : undefined;
        return g ? { x: g.x, y: g.y } : { x: 0, y: 0 };
    };
    const collectEdges = (n: ElkNode) => {
        for (const e of n.edges ?? []) {
            const sec = e.sections?.[0];
            const o = lcaOffset(e.sources[0], e.targets[0]);
            let pts: XY[];
            if (sec) {
                pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
                    .map(pt => ({ x: o.x + pt.x, y: o.y + pt.y }));
            } else {
                // ELK gave no route — fall back to a straight line clipped to
                // each node's border (so the arrowhead lands on the edge, not
                // inside the box).
                const sg = geom.get(e.sources[0]), tg = geom.get(e.targets[0]);
                if (!sg || !tg) { continue; }
                const sc = { x: sg.x + sg.w / 2, y: sg.y + sg.h / 2 };
                const tc = { x: tg.x + tg.w / 2, y: tg.y + tg.h / 2 };
                pts = [borderPoint(sg, tc), borderPoint(tg, sc)];
            }
            const lb = e.labels?.[0];
            const label = (lb && lb.x != null && lb.y != null) ? { x: o.x + lb.x, y: o.y + lb.y } : undefined;
            routed.push({ id: e.id, pts: simplify(pts), label });
        }
        for (const c of n.children ?? []) { collectEdges(c); }
    };
    collectEdges(result);

    // Midpoint along a polyline by arc length (better than the middle vertex).
    const midAlong = (pts: XY[]): XY => {
        let total = 0;
        for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y); }
        let half = total / 2;
        for (let i = 1; i < pts.length; i++) {
            const seg = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
            if (half <= seg) {
                const f = seg ? half / seg : 0;
                return { x: pts[i-1].x + (pts[i].x - pts[i-1].x) * f, y: pts[i-1].y + (pts[i].y - pts[i-1].y) * f };
            }
            half -= seg;
        }
        return pts[Math.floor(pts.length / 2)];
    };

    // ── Draw routed edge paths ───────────────────────────────────────────
    interface Lbl { cx: number; cy: number; w: number; h: number; lines: string[]; srcId: string; tgtId: string; path: SVGElement }
    const lbls: Lbl[] = [];
    for (const r of routed) {
        if (r.pts.length < 2) { continue; }
        const meta = edgeMeta.get(r.id);
        const path = el('path', {
            d: roundedPath(r.pts, 16),
            fill: 'none', stroke: C.fg, 'stroke-width': 1.5, 'stroke-opacity': 0.7,
            'marker-end': 'url(#arr)',
        });
        gEdges.appendChild(path);
        const lines = meta?.lines ?? [];
        if (meta && lines.length) {
            const w = Math.max(...lines.map(l => Math.ceil(textW(l, ACTION_PX)))) + 12;
            const h = lines.length * ACTION_LINE_H + 4;
            // Use ELK's reserved label slot (top-left → centre); else midpoint.
            const cx = r.label ? r.label.x + w / 2 : midAlong(r.pts).x;
            const cy = r.label ? r.label.y + h / 2 : midAlong(r.pts).y;
            lbls.push({ cx, cy, w, h, lines, srcId: meta.srcId, tgtId: meta.tgtId, path });
        } else if (meta) {
            registerEdge(meta.srcId, meta.tgtId, { path, labelG: null });
        }
    }

    // ── De-overlap labels (ELK routes the lines; we place the labels) ────
    for (let iter = 0; iter < 60; iter++) {
        let moved = false;
        for (let i = 0; i < lbls.length; i++) {
            for (let j = i + 1; j < lbls.length; j++) {
                const a = lbls[i], b = lbls[j];
                let dx = b.cx - a.cx, dy = b.cy - a.cy;
                const mx = (a.w + b.w) / 2 + 6, my = (a.h + b.h) / 2 + 4;
                if (Math.abs(dx) < mx && Math.abs(dy) < my) {
                    if (dx === 0 && dy === 0) { dx = (i % 2 ? 1 : -1) * 0.5; dy = 0.5; }
                    const px = (mx - Math.abs(dx)) / 2 + 1, py = (my - Math.abs(dy)) / 2 + 1;
                    if (py <= px) { a.cy -= py * Math.sign(dy || 1); b.cy += py * Math.sign(dy || 1); }
                    else { a.cx -= px * Math.sign(dx || 1); b.cx += px * Math.sign(dx || 1); }
                    moved = true;
                }
            }
        }
        if (!moved) { break; }
    }

    // ── Draw labels ──────────────────────────────────────────────────────
    for (const L of lbls) {
        const bx = L.cx - L.w / 2, by = L.cy - L.h / 2;
        const labelG = el('g', { 'data-src': L.srcId, 'data-tgt': L.tgtId });
        (labelG as SVGElement).style.cursor = 'pointer';
        labelG.appendChild(el('rect', {
            x: bx - 2, y: by, width: L.w + 4, height: L.h + 2,
            rx: 3, ry: 3, fill: C.bg, 'fill-opacity': 1,
            stroke: C.fg, 'stroke-width': 0.5, 'stroke-opacity': 0.12,
        }));
        const padTop = ((L.h + 2) - L.lines.length * ACTION_LINE_H) / 2;
        for (let i = 0; i < L.lines.length; i++) {
            // Event/guard labels are primary semantic content — full foreground
            // contrast, not the dimmed description colour.
            const lineEl = txt(L.lines[i], bx + L.w / 2, by + padTop + (i + 0.5) * ACTION_LINE_H, {
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                'font-size': ACTION_PX, fill: C.fg,
            });
            lineEl.setAttribute('data-event', L.lines[i]);
            labelG.appendChild(lineEl);
        }
        labelG.addEventListener('mouseenter', () => {
            L.path.setAttribute('stroke-opacity', '0.95');
            L.path.setAttribute('stroke-width', '2');
        });
        labelG.addEventListener('mouseleave', () => {
            L.path.setAttribute('stroke-opacity', '0.7');
            L.path.setAttribute('stroke-width', '1.5');
        });
        gLabels.appendChild(labelG);
        registerEdge(L.srcId, L.tgtId, { path: L.path, labelG });
    }

    // (Initial-state arrows are now routed by ELK alongside the other edges.)

    // ── Self-transitions ──────────────────────────────────────────────────
    // A transition back to its own state: draw a smooth rounded arch above the
    // top edge (both ends on the top edge, control points spread wide so the
    // curve is gentle and never hooks sharply).
    for (const [id, label] of selfEdges.entries()) {
        const r = geom.get(id);
        if (!r) { continue; }
        const x1 = r.x + r.w * 0.40, x2 = r.x + r.w * 0.66;  // exit / entry on top edge
        const y0 = r.y;
        const k = 30;                                         // arch height
        gEdges.appendChild(el('path', {
            d: `M ${x1} ${y0} C ${x1} ${y0 - k} ${x2} ${y0 - k} ${x2} ${y0}`,
            fill: 'none', stroke: C.fg, 'stroke-width': 1.4, 'stroke-opacity': 0.7,
            'marker-end': 'url(#arr)',
        }));
        const lines = label ? label.split('\n').filter(Boolean) : [];
        if (lines.length) {
            const lw = Math.max(...lines.map(l => Math.ceil(textW(l, ACTION_PX)))) + 12;
            const cxp = (x1 + x2) / 2;
            const by = y0 - k * 0.75 - lines.length * ACTION_LINE_H / 2;
            const g = el('g', { 'data-src': id });
            (g as SVGElement).style.cursor = 'pointer';
            g.appendChild(el('rect', { x: cxp - lw / 2 - 2, y: by, width: lw + 4, height: lines.length * ACTION_LINE_H + 4, rx: 3, ry: 3, fill: C.bg, 'fill-opacity': 1, stroke: C.fg, 'stroke-width': 0.5, 'stroke-opacity': 0.12 }));
            for (let i = 0; i < lines.length; i++) {
                const t = txt(lines[i], cxp, by + (i + 0.5) * ACTION_LINE_H + ACTION_LINE_H / 2, { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': ACTION_PX, fill: C.fg });
                t.setAttribute('data-event', lines[i]);
                g.appendChild(t);
            }
            gLabels.appendChild(g);
        }
    }

    // Fit on demand; otherwise restore the prior pan/zoom onto the freshly
    // rebuilt viewport group (which would otherwise sit at the identity).
    if (opts.fit) { fitToScreen(); } else { applyTransform(); }
    // A selected node that survived this render keeps its focus ring; one that
    // vanished (e.g. hidden inside a state that was just collapsed) is dropped.
    if (selectedId && !geom.has(selectedId)) { selectedId = null; }
    applyNodeStyle(selectedId);
    refreshEdgeEmphasis();  // re-assert the selected node's edge emphasis on the rebuilt edges
    if (simMode) { paintSim(); }  // re-assert the active-state overlay onto fresh rects
}

// ── Keyboard navigation ─────────────────────────────────────────────────────
// Every node with geometry is selectable except the initial-state dots.
const selectableIds = (): string[] =>
    [...geom.keys()].filter(id => !nodeById.get(id)?.start);
const centerOf = (id: string) => {
    const r = geom.get(id)!;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

// Default visual style of a node's primary shape — mirrors how drawNode creates
// it, so selection styling can be applied and cleanly reverted without a ring.
function nodeStyle(id: string): { fill: string; stroke: string; sw: number; so: number } {
    const d = nodeById.get(id);
    const isParallel = !!d?.parallel;
    const stroke = isParallel ? C.stParallel : C.fg;
    if (d?.ghost)   { return { fill: 'none',    stroke: C.fg, sw: 1.2, so: 0.45 }; }
    if (d?.history) { return { fill: C.nodeBg,  stroke: C.fg, sw: 1.5, so: 0.8  }; }
    const isRegion = childStateIds(id).length > 0 && !collapsed.has(id);
    if (isRegion)   { return { fill: 'none',    stroke, sw: isParallel ? 1.6 : 1.5, so: isParallel ? 0.85 : 0.6 }; }
    return { fill: C.nodeBg, stroke, sw: isParallel ? 1.6 : 1.5, so: isParallel ? 0.85 : 0.8 };
}

// Paint a node in its default style, or — if it is the selected one — in the
// VS Code selected-tree-row colours (active-selection background + focus
// border) so selection reads like the tree, not an extra ring.
function applyNodeStyle(id: string | null) {
    if (!id) { return; }
    const rect = nodeRectById.get(id);
    if (!rect) { return; }
    const base = nodeStyle(id);
    const sel = id === selectedId;
    rect.setAttribute('fill', sel && base.fill !== 'none' ? C.selBg : base.fill);
    rect.setAttribute('stroke', sel ? C.focus : base.stroke);
    rect.setAttribute('stroke-width', String(sel ? 2 : base.sw));
    rect.setAttribute('stroke-opacity', String(sel ? 1 : base.so));
}

// Pan (eased) the minimum amount so a node sits inside the viewport (48px
// margin). Only moves when the node is actually off-screen, so an already-
// visible node never jumps.
function ensureNodeVisible(id: string | null) {
    if (!id) { return; }
    const r = geom.get(id);
    if (!r) { return; }
    const cw = container.clientWidth, ch = container.clientHeight, m = 48;
    const sx = r.x * scale + tx, sy = r.y * scale + ty, sw = r.w * scale, sh = r.h * scale;
    let ntx = tx, nty = ty;
    if (sx < m) { ntx += m - sx; } else if (sx + sw > cw - m) { ntx -= sx + sw - (cw - m); }
    if (sy < m) { nty += m - sy; } else if (sy + sh > ch - m) { nty -= sy + sh - (ch - m); }
    if (ntx !== tx || nty !== ty) { animateTo(ntx, nty, scale, 200); }
}
// Keep the selected node on screen as selection moves.
function ensureSelectedVisible() { ensureNodeVisible(selectedId); }

// `emphasize` (default true) gives an explicit selection the hover-style focus
// effect. Passive selection (cursor sync, first open) passes false — just the ring.
// `pan` (default true) brings the node into view; pass false on first open so the
// highlight doesn't shove the freshly-centred diagram off to one edge.
function selectNode(id: string | null, emphasize = true, pan = true) {
    // The simulator owns node styling while active — don't let selection fight it.
    if (simMode) { return; }
    const prev = selectedId;
    selectedId = id;
    emphasized = emphasize && !!id;
    if (prev && prev !== id) { applyNodeStyle(prev); }  // revert old to default
    if (id) { applyNodeStyle(id); }                     // paint new as selected
    refreshEdgeEmphasis();
    if (pan) { ensureSelectedVisible(); }
}

// Move selection to the nearest selectable node in `dir`. Score favours travel
// along the axis of motion over perpendicular drift, so e.g. ArrowRight prefers
// a node to the right and roughly level over one far off-axis.
function navSelect(dir: 'up' | 'down' | 'left' | 'right') {
    const ids = selectableIds();
    if (!ids.length) { return; }
    if (!selectedId || !geom.has(selectedId)) {
        // First press: enter at the top-most, then left-most node.
        const start = ids.slice().sort((a, b) => {
            const ca = centerOf(a), cb = centerOf(b);
            return ca.y - cb.y || ca.x - cb.x;
        })[0];
        selectNode(start);
        return;
    }
    const a = centerOf(selectedId);
    let best: string | null = null, bestScore = Infinity;
    for (const id of ids) {
        if (id === selectedId) { continue; }
        const b = centerOf(id);
        const dx = b.x - a.x, dy = b.y - a.y;
        let along: number, perp: number;
        if (dir === 'right') { if (dx <= 1) { continue; } along = dx; perp = Math.abs(dy); }
        else if (dir === 'left') { if (dx >= -1) { continue; } along = -dx; perp = Math.abs(dy); }
        else if (dir === 'down') { if (dy <= 1) { continue; } along = dy; perp = Math.abs(dx); }
        else { if (dy >= -1) { continue; } along = -dy; perp = Math.abs(dx); }
        const score = along + perp * 2;
        if (score < bestScore) { bestScore = score; best = id; }
    }
    if (best) { selectNode(best); }
}

// Enter on the selected node: toggle a compound (region or collapsed box) or
// jump to a leaf state's source — mirrors a click.
function activateSelected() {
    if (!selectedId) { return; }
    const hasChildren = childStateIds(selectedId).length > 0;
    if (hasChildren) {
        if (collapsed.has(selectedId)) { collapsed.delete(selectedId); } else { collapsed.add(selectedId); }
        rerenderCollapse();
        return;
    }
    vscode.postMessage({ command: 'stateClicked', id: selectedId });
}

function panBy(dir: 'up' | 'down' | 'left' | 'right', step = 90) {
    autoFit = false;
    if (dir === 'right') { tx -= step; } else if (dir === 'left') { tx += step; }
    else if (dir === 'down') { ty -= step; } else { ty += step; }
    applyTransform();
}

const ARROW: Record<string, 'up' | 'down' | 'left' | 'right'> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};
container.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k === ']' || k === '+' || k === '=') { zoomAround(1.25); ev.preventDefault(); return; }
    if (k === '[' || k === '-' || k === '_') { zoomAround(1 / 1.25); ev.preventDefault(); return; }
    if (k === '0' || k === '.') { fitNow(); ev.preventDefault(); return; }
    if (k === '1') { actualSize(); ev.preventDefault(); return; }
    if (k === 'Escape') { if (selectedId) { selectNode(null); ev.preventDefault(); } return; }
    const dir = ARROW[k];
    if (dir) {
        ev.preventDefault();
        if (ev.shiftKey) { panBy(dir); } else { navSelect(dir); }
        return;
    }
    if (k === 'Enter' || k === ' ') { ev.preventDefault(); activateSelected(); }
});

// ── Interaction ───────────────────────────────────────────────────────────────
let panMoved = false;
container.addEventListener('click', (ev) => {
    container.focus();
    if (panMoved) { return; }
    // In simulation, the panel drives everything — don't let canvas clicks
    // collapse active states or hijack the selection.
    if (simMode) { return; }
    const target = ev.target as Element;
    const lineEl = target.closest('[data-event]');
    if (lineEl) {
        const grp = lineEl.closest('[data-src]');
        // Clicking an event selects the state it leads to (its target), panning
        // it into view, and syncs the outline. The transition itself is still
        // surfaced via the eventClicked message (tree highlight).
        const tgt = grp?.getAttribute('data-tgt');
        if (tgt && geom.has(tgt)) { selectNode(tgt); vscode.postMessage({ command: 'stateClicked', id: tgt }); }
        else {
            vscode.postMessage({
                command: 'eventClicked',
                eventName: lineEl.getAttribute('data-event'),
                src: grp?.getAttribute('data-src'),
            });
        }
        return;
    }
    const nodeG = target.closest('[data-id]');
    if (!nodeG) { return; }
    const kind = nodeG.getAttribute('data-kind');
    const id = nodeG.getAttribute('data-id')!;
    if (kind === 'start') { return; }
    // Keep keyboard nav in sync with what was clicked.
    selectNode(id);
    if (kind === 'region' || collapsed.has(id)) {
        if (collapsed.has(id)) { collapsed.delete(id); } else { collapsed.add(id); }
        rerenderCollapse();
        return;
    }
    vscode.postMessage({ command: 'stateClicked', id });
});

container.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    autoFit = false;
    cancelAnim();
    const rect = container.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.1 : 1/1.1;
    const ns = Math.min(3, Math.max(0.1, scale * factor));
    tx = mx - ((mx - tx) / scale) * ns;
    ty = my - ((my - ty) / scale) * ns;
    scale = ns;
    applyTransform();
}, { passive: false });

let dragging = false, lastX = 0, lastY = 0;
container.addEventListener('pointerdown', (ev) => {
    cancelAnim();
    dragging = true; panMoved = false; lastX = ev.clientX; lastY = ev.clientY;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
});
container.addEventListener('pointermove', (ev) => {
    if (!dragging) { return; }
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) { panMoved = true; autoFit = false; }
    tx += dx; ty += dy; lastX = ev.clientX; lastY = ev.clientY;
    applyTransform();
});
container.addEventListener('pointerup',    () => { dragging = false; });
container.addEventListener('pointerleave', () => { dragging = false; });

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command === 'highlight') {
        // Cursor sync from the editor sets the SAME active node the keyboard
        // moves, so the two never fight over a node's colours. A name that
        // isn't currently visible (e.g. inside a collapsed state) clears it.
        // Passive (no edge emphasis) so editing doesn't flicker the diagram.
        selectNode(idByName.get(msg.stateId) ?? null, false);
    } else if (msg?.command === 'setModel') {
        // Live model push (source edit, tree expansion). Swap the data and
        // re-render in place, preserving the user's pan/zoom.
        payload = msg.payload as GraphPayload;
        loadModel(payload);
        if (msg.direction === 'DOWN' || msg.direction === 'RIGHT') { direction = msg.direction; syncDirBtn(); }
        render({ fit: false })
            .then(() => {
                // A live edit invalidates the simulation's state ids — restart it.
                if (simMode) { collapsed.clear(); resetSim(); return; }
                if (msg.select) { selectNode(idByName.get(msg.select) ?? selectedId, false); }
            })
            .catch(showError);
    } else if (msg?.command === 'simReplay') {
        simReplay(msg.transitionIds ?? []);
    }
});

// ── Export ────────────────────────────────────────────────────────────────────
function exportSvg(): void {
    const svgEl = container.querySelector('svg');
    if (!svgEl) { return; }
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(cw));
    clone.setAttribute('height', String(ch));
    clone.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    vscode.postMessage({ command: 'exportSvg', data: new XMLSerializer().serializeToString(clone) });
}

function exportPng(): void {
    const svgEl = container.querySelector('svg');
    if (!svgEl) { return; }
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(cw));
    clone.setAttribute('height', String(ch));
    clone.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(
        new XMLSerializer().serializeToString(clone)
    )));
    const canvas = document.createElement('canvas');
    canvas.width = cw * 2; canvas.height = ch * 2;
    const img = new Image();
    img.onload = () => {
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        vscode.postMessage({ command: 'exportPng', data: canvas.toDataURL('image/png') });
    };
    img.src = url;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function zoomAround(factor: number) {
    autoFit = false;
    const cw = container.clientWidth, ch = container.clientHeight;
    const ns = Math.min(3, Math.max(0.1, scale * factor));
    // Zoom centred on the selected state (or, in the simulator, the active state)
    // so you zoom into/out of it; otherwise keep the viewport centre fixed.
    const focalId = simMode ? simPrimaryLeaf() : selectedId;
    const r = focalId ? geom.get(focalId) : undefined;
    if (r) {
        const lx = r.x + r.w / 2, ly = r.y + r.h / 2;
        animateTo(cw / 2 - lx * ns, ch / 2 - ly * ns, ns, 180);
    } else {
        const cx = cw / 2, cy = ch / 2;
        animateTo(cx - ((cx - tx) / scale) * ns, cy - ((cy - ty) / scale) * ns, ns, 180);
    }
}
// Every node that has child states is a candidate for collapsing.
function compoundIds(): string[] {
    return [...nodeById.keys()].filter(id => childStateIds(id).length > 0);
}
function expandAll() { collapsed.clear(); rerenderCollapse(); }
function collapseAll() {
    collapsed.clear();
    for (const id of compoundIds()) { collapsed.add(id); }
    rerenderCollapse();
}

const dirBtn = document.getElementById('btn-direction');
function syncDirBtn() {
    if (dirBtn) { dirBtn.textContent = direction === 'DOWN' ? '↧' : '↦'; }
}
syncDirBtn();
dirBtn?.addEventListener('click', () => {
    direction = direction === 'DOWN' ? 'RIGHT' : 'DOWN';
    syncDirBtn();
    // Persist host-side so the choice survives refreshes/re-renders.
    vscode.postMessage({ command: 'setDirection', direction });
    render({ fit: true }).catch(showError);
});

document.getElementById('btn-zoom-in')?.addEventListener('click',    () => zoomAround(1.25));
document.getElementById('btn-zoom-out')?.addEventListener('click',   () => zoomAround(1/1.25));
document.getElementById('btn-zoom-reset')?.addEventListener('click', actualSize);
document.getElementById('btn-fit')?.addEventListener('click',        fitNow);
document.getElementById('btn-expand-all')?.addEventListener('click', expandAll);
document.getElementById('btn-collapse-all')?.addEventListener('click', collapseAll);
const internalBtn = document.getElementById('btn-internal');
function syncInternalBtn() { internalBtn?.classList.toggle('active', showInternal); }
syncInternalBtn();
internalBtn?.addEventListener('click', () => {
    showInternal = !showInternal;
    syncInternalBtn();
    rerenderCollapse();  // box heights change — recenter (if autoFit) like a collapse
});

// ── Right-click context menu ────────────────────────────────────────────────
// Replace the webview's default (and inert) copy/cut/paste menu with diagram
// actions. The clicked node, if any, gets its own items at the top.
const ctxMenu = document.getElementById('ctx-menu')!;
function hideCtx() { ctxMenu.hidden = true; ctxMenu.replaceChildren(); }
function ctxItem(label: string, fn: () => void): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.textContent = label;
    el.addEventListener('click', () => { hideCtx(); fn(); });
    return el;
}
function ctxSep(): HTMLElement { const s = document.createElement('div'); s.className = 'ctx-sep'; return s; }

document.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();  // kill the default copy/cut/paste menu everywhere
    hideCtx();
    const items: HTMLElement[] = [];
    const nodeG = (ev.target as Element).closest?.('[data-id]');
    const id = nodeG?.getAttribute('data-id') ?? undefined;
    const kind = nodeG?.getAttribute('data-kind');
    if (id && kind !== 'start' && !nodeById.get(id)?.ghost) {
        items.push(ctxItem('Go to Source', () => vscode.postMessage({ command: 'goToSource', id })));
        if (childStateIds(id).length) {
            const collapsedNow = collapsed.has(id);
            items.push(ctxItem(collapsedNow ? 'Expand State' : 'Collapse State', () => {
                if (collapsedNow) { collapsed.delete(id); } else { collapsed.add(id); }
                rerenderCollapse();
            }));
        }
        items.push(ctxSep());
    }
    items.push(ctxItem('Fit to Screen', fitNow));
    items.push(ctxItem('Actual Size (100%)', actualSize));
    items.push(ctxItem('Expand All', expandAll));
    items.push(ctxItem('Collapse All', collapseAll));
    items.push(ctxItem(showInternal ? 'Hide Internal Transitions' : 'Show Internal Transitions',
        () => { showInternal = !showInternal; syncInternalBtn(); rerenderCollapse(); }));
    items.push(ctxSep());
    items.push(ctxItem('Export as SVG', exportSvg));
    items.push(ctxItem('Export as PNG', exportPng));
    items.push(ctxItem('Export as Mermaid', () => vscode.postMessage({ command: 'exportMermaid' })));
    ctxMenu.replaceChildren(...items);

    ctxMenu.hidden = false;
    // Position at the cursor, clamped inside the window.
    let x = ev.clientX, y = ev.clientY;
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    if (x + mw > window.innerWidth) { x = window.innerWidth - mw - 4; }
    if (y + mh > window.innerHeight) { y = window.innerHeight - mh - 4; }
    ctxMenu.style.left = Math.max(2, x) + 'px';
    ctxMenu.style.top = Math.max(2, y) + 'px';
});
window.addEventListener('click', hideCtx);
window.addEventListener('blur', hideCtx);
container.addEventListener('wheel', hideCtx, { passive: true });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { hideCtx(); } });
document.getElementById('btn-export-svg')?.addEventListener('click', exportSvg);
document.getElementById('btn-export-png')?.addEventListener('click', exportPng);
document.getElementById('btn-export-mermaid')?.addEventListener('click', () => vscode.postMessage({ command: 'exportMermaid' }));

// ── Interactive simulator ───────────────────────────────────────────────────
// Walk the machine statically: highlight the active state configuration, offer
// the enabled transitions as buttons, and keep a step-back-able trace. Guards
// can't be evaluated statically, so each guarded branch is its own button.
let simMode = false;
let simConfig = new Set<string>();
interface TraceEntry { label: string; leaves: string; prev: Set<string>; leaf?: string }
const simTrace: TraceEntry[] = [];

const simPanel   = document.getElementById('sim-panel');
const simStatus  = document.getElementById('sim-status');
const simEvents  = document.getElementById('sim-events');
const simTraceEl = document.getElementById('sim-trace');
const simBtn     = document.getElementById('btn-simulate');

const activeLeafList = (cfg: Set<string>): { id: string; label: string }[] => {
    if (!simIndex) { return []; }
    return [...cfg]
        .map(id => simIndex!.byId.get(id))
        .filter((s): s is NonNullable<typeof s> => !!s && (s.type === 'atomic' || s.type === 'final'))
        .map(s => ({ id: s.id, label: s.label }));
};
const leafNames = (cfg: Set<string>): string => activeLeafList(cfg).map(l => l.label).join(', ');
// Pan a state into view and select it in the outline — used by the clickable
// active/trace items so you can jump to any state from the simulator panel.
function focusSimState(id: string | undefined): void {
    if (!id || !geom.has(id)) { return; }
    ensureNodeVisible(id);
    vscode.postMessage({ command: 'stateClicked', id });
}
const transitionLabel = (t: SimTransition): string =>
    `${t.event || '(always)'}${t.guard ? ` [${t.guard}]` : ''}`;

// Paint the active configuration over the diagram: active states get a green
// outline, everything else fades back.
function paintSim(): void {
    for (const id of nodeRectById.keys()) {
        const rect = nodeRectById.get(id);
        if (!rect) { continue; }
        const base = nodeStyle(id);
        const active = simConfig.has(id);
        rect.setAttribute('fill', base.fill);
        rect.setAttribute('stroke', active ? C.simActive : base.stroke);
        rect.setAttribute('stroke-width', String(active ? 3 : base.sw));
        rect.setAttribute('stroke-opacity', active ? '1' : String(base.so));
        rect.setAttribute('opacity', active ? '1' : '0.4');
    }
    // Emphasise edges touching the active configuration.
    resetEdgeStyles();
    const mine = new Set<EdgeEntry>();
    for (const id of simConfig) { for (const e of (nodeEdgeMap.get(id) ?? [])) { mine.add(e); } }
    for (const e of allEdges) {
        if (mine.has(e)) {
            e.path.setAttribute('opacity', '1');
            e.path.setAttribute('stroke-opacity', '0.95');
            e.path.setAttribute('stroke-width', '2');
        } else {
            e.path.setAttribute('opacity', '0.1');
            if (e.labelG) { e.labelG.setAttribute('opacity', '0.12'); }
        }
    }
}

function renderSimPanel(): void {
    if (!simIndex || !simEvents || !simTraceEl || !simStatus) { return; }
    const done = isDone(simIndex, simConfig);
    // Active state(s) as clickable chips — click to pan to & select the state.
    simStatus.replaceChildren();
    simStatus.appendChild(document.createTextNode(`${done ? '✓ done · ' : ''}active: `));
    const leaves = activeLeafList(simConfig);
    if (!leaves.length) { simStatus.appendChild(document.createTextNode('—')); }
    leaves.forEach((l, i) => {
        if (i) { simStatus.appendChild(document.createTextNode(', ')); }
        const chip = document.createElement('span');
        chip.className = 'sim-link';
        chip.textContent = l.label;
        chip.addEventListener('click', () => focusSimState(l.id));
        simStatus.appendChild(chip);
    });

    // Enabled transitions → one button each (guarded branches stay distinct).
    simEvents.replaceChildren();
    const enabled = enabledTransitions(simIndex, simConfig);
    if (enabled.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sim-empty';
        empty.textContent = done ? 'Reached a final state.' : 'No enabled transitions.';
        simEvents.appendChild(empty);
    }
    for (const t of enabled) {
        const btn = document.createElement('button');
        btn.className = 'sim-event';
        const tgt = t.target ? simIndex.byId.get(t.target)?.label : undefined;
        btn.innerHTML = `<span class="sim-ev">${escapeHtml(transitionLabel(t))}</span>`
            + (tgt ? `<span class="sim-to">→ ${escapeHtml(tgt)}</span>` : `<span class="sim-to sim-internal">internal</span>`);
        btn.addEventListener('click', () => fireSim(t));
        simEvents.appendChild(btn);
    }

    // Trace.
    simTraceEl.replaceChildren();
    simTrace.forEach((entry, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="sim-ev">${escapeHtml(entry.label)}</span><span class="sim-to">${escapeHtml(entry.leaves || '—')}</span>`;
        if (i === simTrace.length - 1) { li.className = 'sim-current'; }
        // Click a trace row to pan to & select the state it landed on.
        if (entry.leaf) { li.classList.add('sim-clickable'); li.addEventListener('click', () => focusSimState(entry.leaf)); }
        simTraceEl.appendChild(li);
    });
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// The deepest active leaf (atomic/final) — the "current" state to surface in the
// tree and keep on screen as the simulation advances.
function simPrimaryLeaf(): string | undefined {
    if (!simIndex) { return undefined; }
    let best: string | undefined, bestDepth = -1;
    for (const id of simConfig) {
        const s = simIndex.byId.get(id);
        if (!s || (s.type !== 'atomic' && s.type !== 'final')) { continue; }
        let d = 0, cur = s.parent;
        while (cur) { d++; cur = simIndex.byId.get(cur)?.parent; }
        if (d > bestDepth) { bestDepth = d; best = id; }
    }
    return best;
}
// After the active config changes: pan the active state into view (unless the
// caller just centred the diagram) and select it in the tree outline.
function simSync(pan = true): void {
    const leaf = simPrimaryLeaf();
    if (!leaf) { return; }
    if (pan) { ensureNodeVisible(leaf); }
    vscode.postMessage({ command: 'stateClicked', id: leaf });
}

function fireSim(t: SimTransition): void {
    if (!simIndex) { return; }
    const prev = simConfig;
    simConfig = fire(simIndex, simConfig, t);
    simTrace.push({ label: transitionLabel(t), leaves: leafNames(simConfig), prev, leaf: simPrimaryLeaf() });
    paintSim();
    renderSimPanel();
    simSync();
}

function resetSim(pan = true): void {
    if (!simIndex) { return; }
    simConfig = initialConfig(simIndex);
    simTrace.length = 0;
    paintSim();
    renderSimPanel();
    simSync(pan);
}

function stepBackSim(): void {
    const entry = simTrace.pop();
    if (!entry) { return; }
    simConfig = entry.prev;
    paintSim();
    renderSimPanel();
    simSync();
}

function enterSimMode(afterReady?: () => void): void {
    if (!simIndex || simIndex.model.states.length === 0) { return; }
    simMode = true;
    simBtn?.classList.add('active');
    if (simPanel) { simPanel.hidden = false; }
    // Clear any selection styling, then expand so every active state is visible.
    selectedId = null;
    const wasCollapsed = collapsed.size > 0;
    collapsed.clear();
    // Always centre the whole machine when the simulator starts. resetSim(false)
    // sets the initial config and syncs the tree but doesn't pan, so the fit wins.
    const start = () => {
        resetSim(false);
        autoFit = true;
        const t = fitTarget();
        animateTo(t.tx, t.ty, t.scale);
        afterReady?.();
    };
    if (wasCollapsed) { render().then(start).catch(showError); } else { start(); }
}

// Replay a precomputed path (transition ids) from the initial config — used by
// "How do I reach this state?" → Replay in Simulator.
function simReplay(transitionIds: string[]): void {
    const fireAll = () => {
        if (!simIndex) { return; }
        for (const id of transitionIds) {
            const t = simIndex.model.transitions.find(x => x.id === id);
            if (t) { fireSim(t); }
        }
    };
    if (simMode) { resetSim(); fireAll(); } else { enterSimMode(fireAll); }
}

function exitSimMode(): void {
    simMode = false;
    simBtn?.classList.remove('active');
    if (simPanel) { simPanel.hidden = true; }
    // Restore the normal node/edge styling (paintSim dimmed inactive rects via
    // `opacity`, which applyNodeStyle doesn't touch — clear it explicitly).
    for (const id of nodeRectById.keys()) {
        nodeRectById.get(id)?.setAttribute('opacity', '1');
        applyNodeStyle(id);
    }
    resetEdgeStyles();
}

simBtn?.addEventListener('click', () => { if (simMode) { exitSimMode(); } else { enterSimMode(); } });
document.getElementById('sim-reset')?.addEventListener('click', resetSim);
document.getElementById('sim-back')?.addEventListener('click', stepBackSim);
document.getElementById('sim-close')?.addEventListener('click', exitSimMode);

// ── Error display ─────────────────────────────────────────────────────────────
function showError(err: unknown): void {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    container.replaceChildren();
    const pre = document.createElement('pre');
    pre.textContent = `Failed to render statechart:\n\n${msg}`;
    pre.style.cssText = 'padding:16px;color:var(--vscode-errorForeground);white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;';
    container.appendChild(pre);
}

render({ fit: true }).then(() => {
    // Re-fit once the container has a real size, so the first render reliably
    // auto-centres even if layout wasn't settled when the sync fit ran.
    fitWhenReady();
    container.focus();
    // Highlight the node the panel was opened on, if any — but keep the diagram
    // centred (no pan), so right-click → View Diagram opens centred.
    if (initialSelect) { selectNode(idByName.get(initialSelect) ?? null, false, false); }
    // If opened to replay a path, enter the simulator and fire the sequence.
    const initialReplay = (window as unknown as { __REPLAY__?: string[] }).__REPLAY__;
    if (initialReplay && initialReplay.length) { simReplay(initialReplay); }
}).catch(showError);
