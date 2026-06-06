// Webview bundle: ELK layout + custom bezier edge rendering.
// ELK computes node positions; all edge paths are drawn from node geometry.
import ELK from 'elkjs/lib/elk.bundled.js';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface NodeData {
    id: string; label: string; name: string;
    parent?: string; initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
    entryActions?: string[]; exitActions?: string[];
}
interface GraphPayload {
    nodes: { data: NodeData }[];
    edges: { data: { id: string; source: string; target: string; label: string } }[];
    collapsedIds?: string[];
}
interface ElkNode {
    id: string; width?: number; height?: number; x?: number; y?: number;
    labels?: { text: string; width?: number; height?: number; layoutOptions?: Record<string, string> }[];
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?: { id: string; sources: string[]; targets: string[] }[];
}

const SVGNS = 'http://www.w3.org/2000/svg';
const vscode = acquireVsCodeApi();
const payload: GraphPayload = (window as unknown as { __GRAPH__: GraphPayload }).__GRAPH__;
const elk = new ELK();

// Layout flow direction, toggled from the toolbar. 'DOWN' = top-to-bottom,
// 'RIGHT' = left-to-right. Edge routing adapts via per-side outward normals.
let direction: 'DOWN' | 'RIGHT' = 'DOWN';

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
            // Enough between-layer gap for arrows and their labels, without the
            // diagram becoming needlessly long.
            'elk.layered.spacing.nodeNodeBetweenLayers': '70',
            'elk.spacing.nodeNode': '44',
            'elk.padding': `[top=${REGION_H + 24},left=22,bottom=22,right=22]`,
        },
        children: (childrenOf.get(id) ?? []).map(buildElkNode),
    };
}

function buildElkGraph(): ElkNode {
    const seen = new Set<string>();
    const edges: { id: string; sources: string[]; targets: string[] }[] = [];
    for (const e of payload.edges) {
        const s = visibleEndpoint(e.data.source), t = visibleEndpoint(e.data.target);
        if (s === t) { continue; }
        const key = `${s} ${t}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        edges.push({ id: e.data.id, sources: [s], targets: [t] });
    }
    return {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': direction,
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.layered.spacing.nodeNodeBetweenLayers': '70',
            'elk.spacing.nodeNode': '44',
            'elk.layered.thoroughness': '12',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
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
    const result = await elk.layout(buildElkGraph()) as ElkNode;
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

    // ── Pass 3: compute edge bezier params ────────────────────────────────
    // Deduplicate edges after visibility transform, merging labels.
    const visEdges = new Map<string, string>(); // "srcId tgtId" → merged label
    for (const e of payload.edges) {
        if (e.data.source.startsWith('start_')) { continue; }
        const s = visibleEndpoint(e.data.source), t = visibleEndpoint(e.data.target);
        if (s === t) { continue; }
        const key = `${s} ${t}`, lbl = e.data.label.trim();
        const prev = visEdges.get(key);
        visEdges.set(key, prev ? (lbl ? `${prev}\n${lbl}` : prev) : lbl);
    }

    interface BezierEdge {
        srcId: string; tgtId: string; label: string;
        sx: number; sy: number; cp1x: number; cp1y: number;
        cp2x: number; cp2y: number; ex: number; ey: number;
        // Label geometry — resolved by push-apart
        lmx: number; lmy: number; lw: number; lh: number; lines: string[];
    }

    // Classify each edge and record which border side it attaches to at each
    // end, so multiple edges sharing a node spread across that border instead
    // of stacking on its centre.
    type Side = 'T' | 'B' | 'L' | 'R';
    interface Spec {
        srcId: string; tgtId: string; label: string; lines: string[]; lw: number; lh: number;
        kind: 'backward' | 'lateral' | 'forward';
        sg: Rect; tg: Rect; sSide: Side; tSide: Side;
    }
    // Project onto flow (main) and perpendicular (cross) axes per direction so
    // the same classification works for both DOWN and RIGHT layouts.
    const DOWN = direction === 'DOWN';
    const mainC  = (r: Rect) => DOWN ? r.y + r.h/2 : r.x + r.w/2;
    const crossC = (r: Rect) => DOWN ? r.x + r.w/2 : r.y + r.h/2;
    const mainSize = (r: Rect) => DOWN ? r.h : r.w;

    const specs: Spec[] = [];
    for (const [key, label] of visEdges.entries()) {
        const sp = key.indexOf(' ');
        const srcId = key.slice(0, sp), tgtId = key.slice(sp + 1);
        const sg = geom.get(srcId), tg = geom.get(tgtId);
        if (!sg || !tg) { continue; }

        const ms = mainC(sg), mt = mainC(tg);
        const cs = crossC(sg), ct = crossC(tg);
        const isBackward = mt < ms - 10;
        const isLateral  = !isBackward && Math.abs(mt - ms) < Math.max(mainSize(sg), mainSize(tg)) * 0.8;

        let kind: Spec['kind'], sSide: Side, tSide: Side;
        if (isBackward) {
            // Loop back on the "negative cross" face (left for DOWN, top for RIGHT).
            kind = 'backward';
            [sSide, tSide] = DOWN ? ['L', 'L'] : ['T', 'T'];
        } else if (isLateral) {
            // Same layer → connect the facing cross sides.
            kind = 'lateral';
            if (DOWN) { [sSide, tSide] = ct >= cs ? ['R', 'L'] : ['L', 'R']; }
            else      { [sSide, tSide] = ct >= cs ? ['B', 'T'] : ['T', 'B']; }
        } else {
            // Forward along the flow: exit the leading face, enter the trailing one.
            kind = 'forward';
            [sSide, tSide] = DOWN ? ['B', 'T'] : ['R', 'L'];
        }

        const lines = label ? label.split('\n').filter(Boolean) : [];
        const lw = lines.length ? Math.max(...lines.map(l => Math.ceil(textW(l, ACTION_PX)))) + 16 : 0;
        const lh = lines.length ? lines.length * ACTION_LINE_H + 4 : 0;
        specs.push({ srcId, tgtId, label, lines, lw, lh, kind, sg, tg, sSide, tSide });
    }

    // Distribute attachment points: group every endpoint by (node, side), order
    // them by the opposite end's cross-axis position (fewest crossings), then
    // spread them evenly along that border.
    const srcAt = new Map<Spec, { x: number; y: number }>();
    const tgtAt = new Map<Spec, { x: number; y: number }>();
    const vert = (s: Side) => s === 'L' || s === 'R';
    const distribute = (
        which: 'src' | 'tgt',
        sideOf: (s: Spec) => Side,
        rectOf: (s: Spec) => Rect,
        order: (s: Spec) => number,
    ) => {
        const groups = new Map<string, Spec[]>();
        for (const s of specs) {
            const k = `${which === 'src' ? s.srcId : s.tgtId}:${sideOf(s)}`;
            (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
        }
        for (const arr of groups.values()) {
            arr.sort((a, b) => order(a) - order(b));
            const n = arr.length;
            arr.forEach((s, i) => {
                const r = rectOf(s), side = sideOf(s), f = (i + 1) / (n + 1);
                let x: number, y: number;
                if (vert(side)) {
                    const m = Math.min(12, r.h * 0.3);
                    y = r.y + m + f * (r.h - 2 * m);
                    x = side === 'L' ? r.x : r.x + r.w;
                } else {
                    const m = Math.min(16, r.w * 0.3);
                    x = r.x + m + f * (r.w - 2 * m);
                    y = side === 'T' ? r.y : r.y + r.h;
                }
                (which === 'src' ? srcAt : tgtAt).set(s, { x, y });
            });
        }
    };
    const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
    distribute('src', s => s.sSide, s => s.sg, s => vert(s.sSide) ? cy(s.tg) : cx(s.tg));
    distribute('tgt', s => s.tSide, s => s.tg, s => vert(s.tSide) ? cy(s.sg) : cx(s.sg));

    const bezierEdges: BezierEdge[] = [];
    // Control-point offset along the main axis. Clamped to ≤ half the span so
    // the two control points never cross — crossing produces a cusp/hook that
    // renders as a kinked arrowhead. Degenerate (tiny/negative) spans collapse
    // to a near-straight line.
    const lerpBend = (span: number) => {
        const d = Math.max(0, span);
        return Math.min(d * 0.5, Math.max(14, d * 0.4));
    };

    // Unit outward normal of a border side — control points extend along it so
    // the curve leaves/enters each node perpendicular to its face. Offsetting
    // each control point along its own normal (rather than to a shared column)
    // keeps the curve smooth and cusp-free.
    const outward = (side: Side): [number, number] =>
        side === 'T' ? [0, -1] : side === 'B' ? [0, 1] : side === 'L' ? [-1, 0] : [1, 0];

    for (const s of specs) {
        const a = srcAt.get(s)!, b = tgtAt.get(s)!;
        const sx = a.x, sy = a.y, ex = b.x, ey = b.y;
        const [snx, sny] = outward(s.sSide);
        const [tnx, tny] = outward(s.tSide);

        let bend: number;
        if (s.kind === 'backward') {
            // Loop out on the cross side, proportional to how far apart the
            // nodes are along the flow (small loop for neighbours, larger sweep
            // for distant states).
            const along    = Math.abs(mainC(s.sg) - mainC(s.tg));
            const crossOff = Math.abs(crossC(s.sg) - crossC(s.tg));
            bend = Math.min(150, Math.max(32, along * 0.45 + crossOff * 0.15));
        } else {
            // Clamp to half the span *along the normal axis* so the two control
            // points can never cross (which is what produced cusps/hooks).
            const span = vert(s.sSide) ? Math.abs(ex - sx) : Math.abs(ey - sy);
            bend = lerpBend(span);
        }
        const cp1x = sx + snx * bend, cp1y = sy + sny * bend;
        const cp2x = ex + tnx * bend, cp2y = ey + tny * bend;

        // Label midpoint at t=0.5 on the cubic bezier
        const lmx = 0.125*sx + 0.375*cp1x + 0.375*cp2x + 0.125*ex;
        const lmy = 0.125*sy + 0.375*cp1y + 0.375*cp2y + 0.125*ey;

        bezierEdges.push({
            srcId: s.srcId, tgtId: s.tgtId, label: s.label,
            sx, sy, cp1x, cp1y, cp2x, cp2y, ex, ey,
            lmx, lmy, lw: s.lw, lh: s.lh, lines: s.lines,
        });
    }

    // ── Label overlap resolution ──────────────────────────────────────────
    // Many distinct edges can route between the same pair of collapsed nodes,
    // so their label midpoints land in a tight cluster. Event labels are wide
    // but short, so separating them vertically is far cheaper than horizontally
    // (~17px vs ~120px). Seed co-located clusters as a centred vertical stack,
    // then run an iterative push-apart, then a guaranteed greedy stack pass so
    // no residual overlap can survive.
    const labelled = bezierEdges.filter(e => e.lines.length > 0);

    const clusters = new Map<string, BezierEdge[]>();
    for (const e of labelled) {
        const key = `${Math.round(e.lmx / 14)},${Math.round(e.lmy / 14)}`;
        const arr = clusters.get(key) ?? [];
        arr.push(e);
        clusters.set(key, arr);
    }
    for (const arr of clusters.values()) {
        if (arr.length < 2) { continue; }
        // Stable order top-to-bottom by source y, then stack vertically centred.
        arr.sort((p, q) => p.sy - q.sy);
        const meanY = arr.reduce((s, e) => s + e.lmy, 0) / arr.length;
        arr.forEach((e, i) => {
            e.lmy = meanY + (i - (arr.length - 1) / 2) * (e.lh + 5);
        });
    }

    const overlaps = (a: BezierEdge, b: BezierEdge) =>
        Math.abs(a.lmx - b.lmx) < (a.lw + b.lw) / 2 + 6 &&
        Math.abs(a.lmy - b.lmy) < (a.lh + b.lh) / 2 + 4;

    // Node boxes the labels must avoid. Region containers are excluded — a
    // transition between siblings legitimately has its label inside the region.
    // Only leaf states and collapsed compound boxes act as obstacles.
    const RPAD = 4;
    const obstacles: Rect[] = [];
    for (const [id, r] of geom.entries()) {
        const d = nodeById.get(id);
        if (!d || d.start) { continue; }
        const isRegion = childStateIds(id).length > 0 && !collapsed.has(id);
        if (isRegion) { continue; }
        obstacles.push(r);
    }
    // Push a label out of any obstacle rect it overlaps, along the cheaper axis.
    const pushOutOfNodes = (e: BezierEdge) => {
        let moved = false;
        for (const r of obstacles) {
            const ncx = r.x + r.w / 2, ncy = r.y + r.h / 2;
            const dx = e.lmx - ncx, dy = e.lmy - ncy;
            const minX = e.lw / 2 + r.w / 2 + RPAD;
            const minY = e.lh / 2 + r.h / 2 + RPAD;
            if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
                const pushX = minX - Math.abs(dx);
                const pushY = minY - Math.abs(dy);
                if (pushY <= pushX) { e.lmy += (dy >= 0 ? 1 : -1) * pushY; }
                else { e.lmx += (dx >= 0 ? 1 : -1) * pushX; }
                moved = true;
            }
        }
        return moved;
    };

    for (let iter = 0; iter < 200; iter++) {
        let moved = false;
        for (let i = 0; i < labelled.length; i++) {
            for (let j = i + 1; j < labelled.length; j++) {
                const a = labelled[i], b = labelled[j];
                let dx = b.lmx - a.lmx, dy = b.lmy - a.lmy;
                const minSepX = (a.lw + b.lw) / 2 + 6;
                const minSepY = (a.lh + b.lh) / 2 + 4;
                if (Math.abs(dx) < minSepX && Math.abs(dy) < minSepY) {
                    if (dx === 0 && dy === 0) { dx = (i % 2 ? 1 : -1) * 0.5; dy = 0.5; }
                    const pushX = (minSepX - Math.abs(dx)) / 2 + 1;
                    const pushY = (minSepY - Math.abs(dy)) / 2 + 1;
                    const signX = dx >= 0 ? 1 : -1;
                    const signY = dy >= 0 ? 1 : -1;
                    // Prefer the cheaper (usually vertical) separation.
                    if (pushY <= pushX) {
                        a.lmy -= pushY * signY; b.lmy += pushY * signY;
                    } else {
                        a.lmx -= pushX * signX; b.lmx += pushX * signX;
                    }
                    moved = true;
                }
            }
        }
        for (const e of labelled) { if (pushOutOfNodes(e)) { moved = true; } }
        if (!moved) { break; }
    }

    // Guaranteed final pass: place labels top-to-bottom; nudge any still-
    // colliding box (against placed labels OR node boxes) straight down.
    const hitsNode = (e: BezierEdge) => obstacles.some(r =>
        Math.abs(e.lmx - (r.x + r.w/2)) < e.lw/2 + r.w/2 + RPAD &&
        Math.abs(e.lmy - (r.y + r.h/2)) < e.lh/2 + r.h/2 + RPAD);
    const placed: BezierEdge[] = [];
    for (const e of [...labelled].sort((a, b) => a.lmy - b.lmy || a.lmx - b.lmx)) {
        let guard = 0;
        while ((placed.some(p => overlaps(e, p)) || hitsNode(e)) && guard++ < 600) {
            e.lmy += 4;
        }
        placed.push(e);
    }

    // ── Pass 4: draw edges and labels ─────────────────────────────────────
    for (const e of bezierEdges) {
        const path = el('path', {
            d: `M ${e.sx} ${e.sy} C ${e.cp1x} ${e.cp1y} ${e.cp2x} ${e.cp2y} ${e.ex} ${e.ey}`,
            fill: 'none', stroke: C.fg,
            'stroke-width': 1.5, 'stroke-opacity': 0.7,
            'marker-end': 'url(#arr)',
        });

        let labelG: SVGElement | null = null;
        if (e.lines.length > 0) {
            const bx = e.lmx - e.lw/2, by = e.lmy - e.lh/2 - 1;
            labelG = el('g', { 'data-src': e.srcId });
            (labelG as SVGElement).style.cursor = 'pointer';
            // Fully opaque background so a label reads cleanly where it sits
            // over an edge; faint border crisps it against the line underneath.
            labelG.appendChild(el('rect', {
                x: bx - 2, y: by, width: e.lw + 4, height: e.lh + 2,
                rx: 3, ry: 3, fill: C.bg, 'fill-opacity': 1,
                stroke: C.fg, 'stroke-width': 0.5, 'stroke-opacity': 0.12,
            }));
            // Box inner padding is (lh+2) − lines·lineH split top/bottom; centre
            // each line in its slot so vertical padding is symmetric.
            const padTop = ((e.lh + 2) - e.lines.length * ACTION_LINE_H) / 2;
            for (let i = 0; i < e.lines.length; i++) {
                // Each line is a distinct event → individually clickable so it
                // can reveal that specific transition in the tree.
                const lineEl = txt(e.lines[i], e.lmx, by + padTop + (i + 0.5) * ACTION_LINE_H, {
                    'text-anchor': 'middle', 'dominant-baseline': 'central',
                    'font-size': ACTION_PX, fill: C.desc,
                });
                lineEl.setAttribute('data-event', e.lines[i]);
                labelG.appendChild(lineEl);
            }
            // Edge hover: brighten this edge when its label is hovered
            labelG.addEventListener('mouseenter', () => {
                path.setAttribute('stroke-opacity', '0.95');
                path.setAttribute('stroke-width', '2');
            });
            labelG.addEventListener('mouseleave', () => {
                path.setAttribute('stroke-opacity', '0.7');
                path.setAttribute('stroke-width', '1.5');
            });
            gLabels.appendChild(labelG);
        }

        gEdges.appendChild(path);
        registerEdge(e.srcId, e.tgtId, { path, labelG });
    }

    // ── Initial-state arrows ──────────────────────────────────────────────
    for (const e of payload.edges) {
        if (!e.data.source.startsWith('start_')) { continue; }
        const sg = geom.get(e.data.source), tg = geom.get(e.data.target);
        if (!sg || !tg) { continue; }
        // DOWN: dot bottom → state top. RIGHT: dot right → state left.
        let sx: number, sy: number, ex: number, ey: number, c1x: number, c1y: number, c2x: number, c2y: number;
        if (DOWN) {
            sx = sg.x + sg.w/2; sy = sg.y + sg.h; ex = tg.x + tg.w/2; ey = tg.y;
            const bend = lerpBend(ey - sy);
            c1x = sx; c1y = sy + bend; c2x = ex; c2y = ey - bend;
        } else {
            sx = sg.x + sg.w; sy = sg.y + sg.h/2; ex = tg.x; ey = tg.y + tg.h/2;
            const bend = lerpBend(ex - sx);
            c1x = sx + bend; c1y = sy; c2x = ex - bend; c2y = ey;
        }
        gEdges.appendChild(el('path', {
            d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`,
            fill: 'none', stroke: C.fg, 'stroke-width': 1.5, 'marker-end': 'url(#arr)',
        }));
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
