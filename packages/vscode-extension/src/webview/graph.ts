// Webview bundle: ELK layout + custom bezier edge rendering.
// ELK computes node positions; all edge paths are drawn from node geometry.
import ELK from 'elkjs/lib/elk.bundled.js';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface NodeData {
    id: string; label: string; name: string;
    parent?: string; initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
    history?: 'shallow' | 'deep'; ghost?: boolean;
    entryActions?: string[]; exitActions?: string[];
}
interface GraphPayload {
    nodes: { data: NodeData }[];
    edges: { data: { id: string; source: string; target: string; label: string } }[];
    collapsedIds?: string[];
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
const payload: GraphPayload = (window as unknown as { __GRAPH__: GraphPayload }).__GRAPH__;
const elk = new ELK();

// Layout flow direction, toggled from the toolbar. 'DOWN' = top-to-bottom,
// 'RIGHT' = left-to-right. Edge routing adapts via per-side outward normals.
// Initialised from the host (persisted per panel, so it survives refreshes).
let direction: 'DOWN' | 'RIGHT' =
    (window as unknown as { __DIRECTION__?: string }).__DIRECTION__ === 'RIGHT' ? 'RIGHT' : 'DOWN';

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
};
const fontFamily = themeVar('--vscode-font-family', 'system-ui, sans-serif');

const measureCtx = document.createElement('canvas').getContext('2d')!;
function textW(s: string, px: number, weight = 'normal'): number {
    measureCtx.font = `${weight} ${px}px ${fontFamily}`;
    return measureCtx.measureText(s).width;
}

// ── Sizing constants ──────────────────────────────────────────────────────────
const LABEL_PX      = 13;
const ACTION_PX     = 11;
const ACTION_LINE_H = 15;
const ACTION_TOP    = 7;
const NODE_V_PAD    = 10;
const REGION_H      = 28;
const MIN_W         = 110;

function nw(label: string, entry: string[], exit: string[]): number {
    // Title is rendered at LABEL_PX (13) and centred; actions at ACTION_PX (11)
    // and left-aligned. Measure each row at its real size + generous side pad.
    const titleW = Math.ceil(textW(label, LABEL_PX, '500')) + 32;
    const actionW = [...entry.map(a => `entry/ ${a}`), ...exit.map(a => `exit/ ${a}`)]
        .map(l => Math.ceil(textW(l, ACTION_PX)) + 24);
    return Math.max(MIN_W, titleW, ...actionW);
}
function nh(entry: string[], exit: string[]): number {
    const n = entry.length + exit.length;
    return n === 0
        ? NODE_V_PAD * 2 + LABEL_PX + 4
        : NODE_V_PAD * 2 + LABEL_PX + 4 + 1 + ACTION_TOP + n * ACTION_LINE_H + 4;
}

// ── Data indexes ──────────────────────────────────────────────────────────────
const nodeById = new Map<string, NodeData>(payload.nodes.map(n => [n.data.id, n.data]));
const childrenOf = new Map<string, string[]>();
for (const n of payload.nodes) {
    const k = n.data.parent ?? '__root__';
    childrenOf.set(k, [...(childrenOf.get(k) ?? []), n.data.id]);
}
const childStateIds = (id: string) =>
    (childrenOf.get(id) ?? []).filter(cid => !nodeById.get(cid)?.start);
const collapsed = new Set<string>(payload.collapsedIds ?? []);

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
        // Render appends a ' ⊕' affordance to collapsed parents — measure it
        // too so the glyph never overflows the box border.
        const isCollapsedParent = states.length > 0 && collapsed.has(id);
        const display = d.label + (isCollapsedParent ? ' ⊕' : '');
        return {
            id,
            width:  nw(display, d.entryActions ?? [], d.exitActions ?? []),
            height: nh(d.entryActions ?? [], d.exitActions ?? []),
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
            'elk.padding': `[top=${REGION_H + 24},left=22,bottom=22,right=22]`,
        },
        children: (childrenOf.get(id) ?? []).map(buildElkNode),
    };
}

// Shared routing/spacing options applied at every hierarchy level so ELK
// routes edges (avoiding nodes, spacing parallels) and places their labels in
// free space instead of us stacking them at curve midpoints.
const ROUTING_OPTS: Record<string, string> = {
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.spacing.nodeNodeBetweenLayers': '70',
    'elk.spacing.nodeNode': '44',
    'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeNodeBetweenLayers': '22',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
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
        edges.push({ id: m.id, sources: [m.s], targets: [m.t] });
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

// ── Viewport ──────────────────────────────────────────────────────────────────
type Rect = { x: number; y: number; w: number; h: number };
const geom = new Map<string, Rect>();
const nameToRect = new Map<string, SVGElement>();
const container = document.getElementById('cy')!;
let viewport: SVGElement;
let scale = 1, tx = 0, ty = 0;
let lastW = 100, lastH = 100;

function applyTransform() {
    viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
}
function fitToScreen() {
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    scale = Math.min(cw / lastW, ch / lastH, 1.5) * 0.92 || 1;
    tx = (cw - lastW * scale) / 2;
    ty = (ch - lastH * scale) / 2;
    applyTransform();
}

// ── Render ────────────────────────────────────────────────────────────────────
async function render(): Promise<void> {
    // Call as a method so elkjs keeps its `this` binding; cast the argument
    // through unknown since our ElkNode shape differs from elkjs's typings.
    const graph = buildElkGraph() as unknown as Parameters<typeof elk.layout>[0];
    const result = await elk.layout(graph) as unknown as ElkNode;
    lastW = result.width ?? 100;
    lastH = result.height ?? 100;

    container.replaceChildren();
    nameToRect.clear();
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
    // read these after edge drawing completes.
    interface EdgeEntry { path: SVGElement; labelG: SVGElement | null }
    const allEdges: EdgeEntry[] = [];
    const nodeEdgeMap = new Map<string, EdgeEntry[]>();
    function registerEdge(srcId: string, tgtId: string, entry: EdgeEntry) {
        allEdges.push(entry);
        for (const id of [srcId, tgtId]) {
            const arr = nodeEdgeMap.get(id) ?? [];
            arr.push(entry);
            nodeEdgeMap.set(id, arr);
        }
    }

    function resetEdgeStyles() {
        for (const { path, labelG } of allEdges) {
            path.setAttribute('stroke-opacity', '0.7');
            path.setAttribute('stroke-width', '1.5');
            if (labelG) { labelG.setAttribute('opacity', '1'); }
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

            if (d.start) {
                g.appendChild(el('circle', { cx: ax + w/2, cy: ay + h/2, r: 6, fill: C.fg }));
                gNodes.appendChild(g);
            } else if (d.history) {
                // History pseudostate: circle with H (shallow) or H* (deep).
                const cxp = ax + w/2, cyp = ay + h/2;
                g.appendChild(el('circle', { cx: cxp, cy: cyp, r: w/2 - 1, fill: C.nodeBg, stroke: C.fg, 'stroke-width': 1.5, 'stroke-opacity': 0.8 }));
                g.appendChild(txt(d.history === 'deep' ? 'H*' : 'H', cxp, cyp, { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 13, 'font-weight': 'bold' }));
                nameToRect.set(d.name, g.firstChild as SVGElement);
                gNodes.appendChild(g);
            } else if (isRegion) {
                const isParallel = !!d.parallel;
                // Regions are outline-only: translucent fills stack on deep
                // nesting and turn muddy, so let the border + title bar define
                // them. Parallel-ness reads from the dashed border + tag.
                const regionRect = el('rect', {
                    x: ax, y: ay, width: w, height: h, rx: 14, ry: 14,
                    fill: 'none',
                    stroke: C.fg,
                    'stroke-width': isParallel ? 1.6 : 1.5,
                    'stroke-opacity': isParallel ? 0.75 : 0.6,
                    ...(isParallel ? { 'stroke-dasharray': '7 4' } : {}),
                });
                g.appendChild(regionRect);
                g.appendChild(el('line', {
                    x1: ax+1, y1: ay+REGION_H, x2: ax+w-1, y2: ay+REGION_H,
                    stroke: C.fg, 'stroke-width': 0.75, 'stroke-opacity': 0.35,
                }));
                g.appendChild(txt(d.label, ax+w/2, ay+REGION_H-9, {
                    'text-anchor': 'middle', 'font-size': 12, 'font-weight': 'bold',
                }));
                if (isParallel) {
                    // Plain "parallel" tag, right-aligned in the title bar.
                    g.appendChild(txt('parallel', ax+w-8, ay+REGION_H-9, {
                        'text-anchor': 'end', 'font-size': 10, fill: C.desc, 'font-style': 'italic',
                    }));
                }
                // Hover: highlight connected edges (closure reads nodeEdgeMap after fill)
                g.addEventListener('mouseenter', () => {
                    regionRect.setAttribute('stroke-width', '2');
                    regionRect.setAttribute('stroke-opacity', '0.9');
                    const mine = new Set(nodeEdgeMap.get(n.id) ?? []);
                    for (const e of allEdges) {
                        if (mine.has(e)) {
                            e.path.setAttribute('stroke-opacity', '0.95');
                            e.path.setAttribute('stroke-width', '2');
                        } else {
                            e.path.setAttribute('stroke-opacity', '0.1');
                            if (e.labelG) { e.labelG.setAttribute('opacity', '0.15'); }
                        }
                    }
                });
                const restW = isParallel ? '1.6' : '1.5';
                const restO = isParallel ? '0.75' : '0.6';
                g.addEventListener('mouseleave', () => {
                    regionRect.setAttribute('stroke-width', restW);
                    regionRect.setAttribute('stroke-opacity', restO);
                    resetEdgeStyles();
                });
                gBack.appendChild(g);
            } else if (d.ghost) {
                // Exit stub: a transition target outside the focused subtree.
                g.appendChild(el('rect', {
                    x: ax, y: ay, width: w, height: h, rx: 8, ry: 8,
                    fill: 'none', stroke: C.fg, 'stroke-width': 1.2,
                    'stroke-opacity': 0.45, 'stroke-dasharray': '4 4',
                }));
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
                    stroke: C.fg,
                    'stroke-width': isParallel ? 1.6 : 1.5,
                    'stroke-opacity': isParallel ? 0.75 : 0.8,
                    ...(isParallel ? { 'stroke-dasharray': '7 4' } : {}),
                });
                nameToRect.set(d.name, rect);
                g.appendChild(rect);
                if (d.final) {
                    g.appendChild(el('rect', {
                        x: ax+4, y: ay+4, width: w-8, height: h-8,
                        rx: 5, ry: 5, fill: 'none',
                        stroke: C.fg, 'stroke-width': 1, 'stroke-opacity': 0.5,
                    }));
                }
                const entry = d.entryActions ?? [];
                const exit  = d.exitActions  ?? [];
                const label = d.label + (isCollapsed && hasChildren ? ' ⊕' : '');
                if (entry.length > 0 || exit.length > 0) {
                    const labelY = ay + NODE_V_PAD + LABEL_PX;
                    g.appendChild(txt(label, ax+w/2, labelY, {
                        'text-anchor': 'middle', 'font-size': LABEL_PX, 'font-weight': '500',
                    }));
                    const divY = labelY + NODE_V_PAD / 2;
                    g.appendChild(el('line', {
                        x1: ax+1, y1: divY, x2: ax+w-1, y2: divY,
                        stroke: C.fg, 'stroke-width': 0.6, 'stroke-opacity': 0.3,
                    }));
                    let lineY = divY + ACTION_TOP + ACTION_PX;
                    for (const a of entry) {
                        g.appendChild(txt(`entry/ ${a}`, ax+8, lineY, { 'font-size': ACTION_PX, fill: C.desc }));
                        lineY += ACTION_LINE_H;
                    }
                    for (const a of exit) {
                        g.appendChild(txt(`exit/ ${a}`, ax+8, lineY, { 'font-size': ACTION_PX, fill: C.desc }));
                        lineY += ACTION_LINE_H;
                    }
                } else {
                    g.appendChild(txt(label, ax+w/2, ay + h/2 + LABEL_PX/2 - 1, {
                        'text-anchor': 'middle', 'font-size': LABEL_PX, 'font-weight': '500',
                    }));
                }
                // Hover: highlight connected edges + thicken border
                g.addEventListener('mouseenter', () => {
                    rect.setAttribute('stroke-width', '2');
                    rect.setAttribute('stroke-opacity', '1');
                    const mine = new Set(nodeEdgeMap.get(n.id) ?? []);
                    for (const e of allEdges) {
                        if (mine.has(e)) {
                            e.path.setAttribute('stroke-opacity', '0.95');
                            e.path.setAttribute('stroke-width', '2');
                        } else {
                            e.path.setAttribute('stroke-opacity', '0.1');
                            if (e.labelG) { e.labelG.setAttribute('opacity', '0.15'); }
                        }
                    }
                });
                g.addEventListener('mouseleave', () => {
                    rect.setAttribute('stroke-width', '1.5');
                    rect.setAttribute('stroke-opacity', '0.8');
                    resetEdgeStyles();
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
        const s = visibleEndpoint(e.data.source), t = visibleEndpoint(e.data.target);
        if (s !== t) { continue; }
        const lbl = e.data.label.trim();
        const prev = selfEdges.get(s);
        selfEdges.set(s, prev ? (lbl ? `${prev}\n${lbl}` : prev) : lbl);
    }

    // Smooth a routed polyline by rounding each corner with a quadratic curve.
    const roundedPath = (p: XY[], r: number): string => {
        if (p.length < 2) { return ''; }
        if (p.length === 2) { return `M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y}`; }
        let d = `M ${p[0].x} ${p[0].y}`;
        for (let i = 1; i < p.length - 1; i++) {
            const a = p[i - 1], c = p[i], b = p[i + 1];
            const d1 = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            const d2 = Math.hypot(b.x - c.x, b.y - c.y) || 1;
            const r1 = Math.min(r, d1 / 2), r2 = Math.min(r, d2 / 2);
            const ix = c.x + (a.x - c.x) / d1 * r1, iy = c.y + (a.y - c.y) / d1 * r1;
            const ox = c.x + (b.x - c.x) / d2 * r2, oy = c.y + (b.y - c.y) / d2 * r2;
            d += ` L ${ix} ${iy} Q ${c.x} ${c.y} ${ox} ${oy}`;
        }
        const last = p[p.length - 1];
        d += ` L ${last.x} ${last.y}`;
        return d;
    };

    // ── Collect ELK-routed edges (sections live on their container node) ──
    interface Routed { id: string; pts: XY[] }
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
            let pts: XY[];
            if (sec) {
                const o = lcaOffset(e.sources[0], e.targets[0]);
                pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
                    .map(pt => ({ x: o.x + pt.x, y: o.y + pt.y }));
            } else {
                // ELK gave no route — fall back to a straight centre-to-centre
                // line (absolute geometry) so the edge is never dropped.
                const sg = geom.get(e.sources[0]), tg = geom.get(e.targets[0]);
                if (!sg || !tg) { continue; }
                pts = [{ x: sg.x + sg.w / 2, y: sg.y + sg.h / 2 }, { x: tg.x + tg.w / 2, y: tg.y + tg.h / 2 }];
            }
            routed.push({ id: e.id, pts });
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
            d: roundedPath(r.pts, 18),
            fill: 'none', stroke: C.fg, 'stroke-width': 1.5, 'stroke-opacity': 0.7,
            'marker-end': 'url(#arr)',
        });
        gEdges.appendChild(path);
        const lines = meta?.lines ?? [];
        if (meta && lines.length) {
            const w = Math.max(...lines.map(l => Math.ceil(textW(l, ACTION_PX)))) + 12;
            const h = lines.length * ACTION_LINE_H + 4;
            const mid = midAlong(r.pts);
            lbls.push({ cx: mid.x, cy: mid.y, w, h, lines, srcId: meta.srcId, tgtId: meta.tgtId, path });
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
        const labelG = el('g', { 'data-src': L.srcId });
        (labelG as SVGElement).style.cursor = 'pointer';
        labelG.appendChild(el('rect', {
            x: bx - 2, y: by, width: L.w + 4, height: L.h + 2,
            rx: 3, ry: 3, fill: C.bg, 'fill-opacity': 1,
            stroke: C.fg, 'stroke-width': 0.5, 'stroke-opacity': 0.12,
        }));
        const padTop = ((L.h + 2) - L.lines.length * ACTION_LINE_H) / 2;
        for (let i = 0; i < L.lines.length; i++) {
            const lineEl = txt(L.lines[i], bx + L.w / 2, by + padTop + (i + 0.5) * ACTION_LINE_H, {
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                'font-size': ACTION_PX, fill: C.desc,
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
                const t = txt(lines[i], cxp, by + (i + 0.5) * ACTION_LINE_H + ACTION_LINE_H / 2, { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': ACTION_PX, fill: C.desc });
                t.setAttribute('data-event', lines[i]);
                g.appendChild(t);
            }
            gLabels.appendChild(g);
        }
    }

    // Always re-fit so expanding/collapsing a node reveals the full diagram.
    fitToScreen();
}

// ── Interaction ───────────────────────────────────────────────────────────────
let panMoved = false;
container.addEventListener('click', (ev) => {
    if (panMoved) { return; }
    const target = ev.target as Element;
    const lineEl = target.closest('[data-event]');
    if (lineEl) {
        const grp = lineEl.closest('[data-src]');
        vscode.postMessage({
            command: 'eventClicked',
            eventName: lineEl.getAttribute('data-event'),
            src: grp?.getAttribute('data-src'),
        });
        return;
    }
    const nodeG = target.closest('[data-id]');
    if (!nodeG) { return; }
    const kind = nodeG.getAttribute('data-kind');
    const id = nodeG.getAttribute('data-id')!;
    if (kind === 'start') { return; }
    if (kind === 'region' || collapsed.has(id)) {
        if (collapsed.has(id)) { collapsed.delete(id); } else { collapsed.add(id); }
        render().catch(showError);
        return;
    }
    vscode.postMessage({ command: 'stateClicked', id });
});

container.addEventListener('wheel', (ev) => {
    ev.preventDefault();
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
    dragging = true; panMoved = false; lastX = ev.clientX; lastY = ev.clientY;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
});
container.addEventListener('pointermove', (ev) => {
    if (!dragging) { return; }
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) { panMoved = true; }
    tx += dx; ty += dy; lastX = ev.clientX; lastY = ev.clientY;
    applyTransform();
});
container.addEventListener('pointerup',    () => { dragging = false; });
container.addEventListener('pointerleave', () => { dragging = false; });

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command === 'highlight') {
        for (const r of nameToRect.values()) {
            r.setAttribute('fill', C.nodeBg);
            r.setAttribute('stroke', C.fg);
            r.setAttribute('stroke-opacity', '0.8');
        }
        const hit = nameToRect.get(msg.stateId);
        if (hit) {
            hit.setAttribute('fill', C.selBg);
            hit.setAttribute('stroke', C.focus);
            hit.setAttribute('stroke-opacity', '1');
        }
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
    const cx = container.clientWidth/2, cy = container.clientHeight/2;
    const ns = Math.min(3, Math.max(0.1, scale * factor));
    tx = cx - ((cx - tx) / scale) * ns;
    ty = cy - ((cy - ty) / scale) * ns;
    scale = ns;
    applyTransform();
}
// Every node that has child states is a candidate for collapsing.
function compoundIds(): string[] {
    return [...nodeById.keys()].filter(id => childStateIds(id).length > 0);
}
function expandAll() { collapsed.clear(); render().catch(showError); }
function collapseAll() {
    collapsed.clear();
    for (const id of compoundIds()) { collapsed.add(id); }
    render().catch(showError);
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
    render().catch(showError);
});

document.getElementById('btn-zoom-in')?.addEventListener('click',    () => zoomAround(1.25));
document.getElementById('btn-zoom-out')?.addEventListener('click',   () => zoomAround(1/1.25));
document.getElementById('btn-fit')?.addEventListener('click',        fitToScreen);
document.getElementById('btn-expand-all')?.addEventListener('click', expandAll);
document.getElementById('btn-collapse-all')?.addEventListener('click', collapseAll);
document.getElementById('btn-export-svg')?.addEventListener('click', exportSvg);
document.getElementById('btn-export-png')?.addEventListener('click', exportPng);

// ── Error display ─────────────────────────────────────────────────────────────
function showError(err: unknown): void {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    container.replaceChildren();
    const pre = document.createElement('pre');
    pre.textContent = `Failed to render statechart:\n\n${msg}`;
    pre.style.cssText = 'padding:16px;color:var(--vscode-errorForeground);white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;';
    container.appendChild(pre);
}

render().catch(showError);
