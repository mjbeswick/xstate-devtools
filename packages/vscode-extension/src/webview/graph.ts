// Webview bundle for the statechart graph.
//
// Layout AND rendering are ELK-native: elkjs computes a hierarchical `layered`
// layout with ORTHOGONAL edge routing, and we draw its output directly as SVG.
// ELK already returns exact node rectangles and orthogonal edge polylines, so
// drawing them verbatim gives clean right-angle Harel-style statecharts with no
// coordinate translation (the previous Cytoscape `segments` approach could not
// reproduce ELK's absolute waypoints).
//
// Built as a standalone browser bundle by esbuild (see esbuild.js).
import ELK from 'elkjs/lib/elk.bundled.js';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

interface NodeData {
    id: string;
    label: string;
    name: string;
    parent?: string;
    initial?: boolean;
    final?: boolean;
    start?: boolean;
    entryActions?: string[];
    exitActions?: string[];
}
interface GraphPayload {
    nodes: { data: NodeData }[];
    edges: { data: { id: string; source: string; target: string; label: string } }[];
    collapsedIds?: string[];
}
interface XY { x: number; y: number }
interface ElkLabel { text: string; width?: number; height?: number; x?: number; y?: number; layoutOptions?: Record<string, string> }
interface ElkNode {
    id: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    labels?: ElkLabel[];
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?: ElkEdge[];
}
interface ElkEdge {
    id: string;
    sources: string[];
    targets: string[];
    labels?: ElkLabel[];
    sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[];
}

const SVGNS = 'http://www.w3.org/2000/svg';
const vscode = acquireVsCodeApi();
const payload: GraphPayload = (window as unknown as { __GRAPH__: GraphPayload }).__GRAPH__;
const elk = new ELK();
const DIRECTION = 'RIGHT';

// ── Theme ───────────────────────────────────────────────────────────────────
const rootStyle = getComputedStyle(document.documentElement);
const bodyStyle = getComputedStyle(document.body);
function themeVar(name: string, fallback: string): string {
    const v = (rootStyle.getPropertyValue(name) || bodyStyle.getPropertyValue(name)).trim();
    return v || fallback;
}
const C = {
    fg: themeVar('--vscode-editor-foreground', '#1f1f1f'),
    bg: themeVar('--vscode-editor-background', '#ffffff'),
    nodeBg: themeVar('--vscode-editorWidget-background', '#f3f3f3'),
    region: themeVar('--vscode-editor-foreground', '#1f1f1f'),
    accent: themeVar('--vscode-charts-blue', '#3b82f6'),
    focus: themeVar('--vscode-focusBorder', '#0090f1'),
    selBg: themeVar('--vscode-list-activeSelectionBackground', '#cce5ff'),
    desc: themeVar('--vscode-descriptionForeground', '#717171'),
};
const fontFamily = themeVar('--vscode-font-family', 'system-ui, sans-serif');

const measureCtx = document.createElement('canvas').getContext('2d')!;
function textWidth(text: string, px: number, weight = 'normal'): number {
    measureCtx.font = `${weight} ${px}px ${fontFamily}`;
    return measureCtx.measureText(text).width;
}
const REGION_TITLE_H = 26;
const ACTION_LINE_H = 14;   // height per entry/exit action row
const ACTION_SECTION_PAD = 8; // space above first action row (below divider)

function nodeWidth(label: string, entryActions: string[] = [], exitActions: string[] = []): number {
    const actionLabels = [
        ...entryActions.map(a => `entry/ ${a}`),
        ...exitActions.map(a => `exit/ ${a}`),
    ];
    const allLabels = [label, ...actionLabels];
    return Math.max(80, Math.max(...allLabels.map(l => Math.ceil(textWidth(l, 11)) + 28)));
}

function nodeHeight(entryActions: string[] = [], exitActions: string[] = []): number {
    const lines = entryActions.length + exitActions.length;
    return lines > 0 ? 28 + ACTION_SECTION_PAD + lines * ACTION_LINE_H + 4 : 36;
}

// ── Indexes ─────────────────────────────────────────────────────────────────
const nodeById = new Map<string, NodeData>(payload.nodes.map(n => [n.data.id, n.data]));
const childrenOf = new Map<string, string[]>();
for (const n of payload.nodes) {
    const key = n.data.parent ?? '__root__';
    const arr = childrenOf.get(key) ?? [];
    arr.push(n.data.id);
    childrenOf.set(key, arr);
}
const childStateIds = (id: string) => (childrenOf.get(id) ?? []).filter(cid => !nodeById.get(cid)?.start);
const collapsed = new Set<string>(payload.collapsedIds ?? []);

function visibleEndpoint(id: string): string {
    const chain: string[] = [];
    let cur: string | undefined = id;
    while (cur) { chain.unshift(cur); cur = nodeById.get(cur)?.parent; }
    for (const c of chain) { if (collapsed.has(c)) { return c; } }
    return id;
}

// ── ELK graph ───────────────────────────────────────────────────────────────
function buildElkNode(id: string): ElkNode {
    const d = nodeById.get(id)!;
    if (d.start) { return { id, width: 13, height: 13 }; }
    const states = childStateIds(id);
    const isRegion = states.length > 0 && !collapsed.has(id);
    if (!isRegion) {
        const w = nodeWidth(d.label, d.entryActions, d.exitActions);
        const h = nodeHeight(d.entryActions, d.exitActions);
        return { id, width: w, height: h, labels: [{ text: d.label }] };
    }
    return {
        id,
        labels: [{
            text: d.label,
            width: Math.ceil(textWidth(d.label, 12, 'bold')),
            height: 16,
            layoutOptions: { 'elk.nodeLabels.placement': 'H_CENTER V_TOP INSIDE' },
        }],
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': DIRECTION,
            // Extra top room so transitions/initial arrows clear the title bar.
            'elk.padding': `[top=${REGION_TITLE_H + 22},left=20,bottom=20,right=20]`,
        },
        children: (childrenOf.get(id) ?? []).map(buildElkNode),
    };
}

function buildElkGraph(): ElkNode {
    const seen = new Set<string>();
    const edges: ElkEdge[] = [];
    for (const e of payload.edges) {
        const s = visibleEndpoint(e.data.source);
        const t = visibleEndpoint(e.data.target);
        if (s === t) { continue; }
        const key = `${s} ${t} ${e.data.label}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        edges.push({
            id: e.data.id,
            sources: [s],
            targets: [t],
            labels: e.data.label ? [{ text: e.data.label, width: Math.ceil(textWidth(e.data.label, 11)) + 10, height: 16 }] : [],
        });
    }
    return {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': DIRECTION,
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.layered.spacing.nodeNodeBetweenLayers': '80',
            'elk.spacing.nodeNode': '46',
            'elk.spacing.edgeNode': '28',
            'elk.spacing.edgeEdge': '28',
            'elk.layered.spacing.edgeNodeBetweenLayers': '28',
            'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
            'elk.layered.thoroughness': '14',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
            'elk.layered.unnecessaryBendpoints': 'true',
            'elk.edgeLabels.placement': 'CENTER',
            'elk.spacing.edgeLabel': '4',
        },
        children: (childrenOf.get('__root__') ?? []).map(buildElkNode),
        edges,
    };
}

// ── SVG helpers ─────────────────────────────────────────────────────────────
function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) { node.setAttribute(k, String(v)); }
    return node;
}
function text(content: string, x: number, y: number, attrs: Record<string, string | number> = {}): SVGElement {
    const t = el('text', { x, y, 'font-family': fontFamily, fill: C.fg, ...attrs });
    t.textContent = content;
    return t;
}

const ARC_PAD = 70; // vertical space reserved above ELK box for backward arcs

const container = document.getElementById('cy')!;
const nameToRect = new Map<string, SVGElement>();
let viewport: SVGElement;
let scale = 1, tx = 0, ty = 0;
let lastW = 100, lastH = 100;
let didFit = false;

function applyTransform() { viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`); }

function fitToScreen() {
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const totalH = lastH + ARC_PAD;
    scale = Math.min(cw / lastW, ch / totalH, 1.5) * 0.94 || 1;
    tx = (cw - lastW * scale) / 2;
    ty = (ch - totalH * scale) / 2;
    applyTransform();
}

// ── Render ──────────────────────────────────────────────────────────────────
async function render(): Promise<void> {
    const result = await elk.layout(buildElkGraph()) as ElkNode;
    const W = result.width ?? 100, H = result.height ?? 100;
    lastW = W; lastH = H;

    container.replaceChildren();
    nameToRect.clear();

    const svg = el('svg', { width: '100%', height: '100%' });
    const defs = el('defs');
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: C.fg }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    viewport = el('g');
    const gRegions = el('g'), gEdges = el('g'), gNodes = el('g'), gLabels = el('g');
    viewport.append(gRegions, gEdges, gNodes, gLabels);
    svg.appendChild(viewport);
    container.appendChild(svg);

    // Nodes (absolute geometry).
    const geom = new Map<string, { x: number; y: number; w: number; h: number }>();
    const drawNode = (n: ElkNode, ox: number, oy: number) => {
        const ax = ox + (n.x ?? 0), ay = oy + (n.y ?? 0);
        if (n.id !== 'root') {
            const d = nodeById.get(n.id)!;
            const w = n.width ?? 64, h = n.height ?? 36;
            geom.set(n.id, { x: ax, y: ay, w, h });
            const isCollapsed = collapsed.has(n.id);
            const isRegion = childStateIds(n.id).length > 0 && !isCollapsed;
            const g = el('g', { 'data-id': n.id, 'data-kind': isRegion ? 'region' : d.start ? 'start' : 'state', 'data-name': d.name });
            (g as SVGElement).style.cursor = 'pointer';

            if (d.start) {
                g.appendChild(el('circle', { cx: ax + w / 2, cy: ay + h / 2, r: 6, fill: C.fg }));
                gNodes.appendChild(g);
            } else if (isRegion) {
                g.appendChild(el('rect', { x: ax, y: ay, width: w, height: h, rx: 16, ry: 16, fill: C.region, 'fill-opacity': 0.035, stroke: C.fg, 'stroke-width': 1.4 }));
                g.appendChild(el('line', { x1: ax, y1: ay + REGION_TITLE_H, x2: ax + w, y2: ay + REGION_TITLE_H, stroke: C.fg, 'stroke-width': 0.8, 'stroke-opacity': 0.5 }));
                g.appendChild(text(d.label, ax + w / 2, ay + REGION_TITLE_H - 8, { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 'bold' }));
                gRegions.appendChild(g);
            } else {
                const rect = el('rect', { x: ax, y: ay, width: w, height: h, rx: 12, ry: 12, fill: C.nodeBg, stroke: C.fg, 'stroke-width': 1.4 });
                nameToRect.set(d.name, rect);
                g.appendChild(rect);
                if (d.final) {
                    g.appendChild(el('rect', { x: ax + 3, y: ay + 3, width: w - 6, height: h - 6, rx: 9, ry: 9, fill: 'none', stroke: C.fg, 'stroke-width': 1 }));
                }
                const entryActions = d.entryActions ?? [];
                const exitActions  = d.exitActions  ?? [];
                const hasActions = entryActions.length > 0 || exitActions.length > 0;
                const stateLabel = d.label + (isCollapsed ? '  ⊕' : '');
                if (hasActions && !isCollapsed) {
                    // Harel convention: name in top section, divider, then actions
                    g.appendChild(text(stateLabel, ax + w / 2, ay + 18, { 'text-anchor': 'middle', 'font-size': 12 }));
                    const divY = ay + 27;
                    g.appendChild(el('line', { x1: ax + 1, y1: divY, x2: ax + w - 1, y2: divY, stroke: C.fg, 'stroke-width': 0.6, 'stroke-opacity': 0.35 }));
                    let lineBaseline = divY + ACTION_SECTION_PAD + 10;
                    for (const a of entryActions) {
                        g.appendChild(text(`entry/ ${a}`, ax + 8, lineBaseline, { 'font-size': 10, fill: C.desc }));
                        lineBaseline += ACTION_LINE_H;
                    }
                    for (const a of exitActions) {
                        g.appendChild(text(`exit/ ${a}`, ax + 8, lineBaseline, { 'font-size': 10, fill: C.desc }));
                        lineBaseline += ACTION_LINE_H;
                    }
                } else {
                    g.appendChild(text(stateLabel, ax + w / 2, ay + h / 2 + 4, { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': isCollapsed ? 'bold' : 'normal' }));
                }
                gNodes.appendChild(g);
            }
        }
        for (const c of n.children ?? []) { drawNode(c, ax, ay); }
    };
    // Pass ARC_PAD as the initial y-offset so all nodes shift down, leaving
    // room at the top for feedback arcs that arc above the diagram.
    drawNode(result, 0, ARC_PAD);

    // Edges — ELK may place same-parent edges on their compound ancestor node
    // rather than the root (even with INCLUDE_CHILDREN).  Recurse through the
    // full result tree so we never miss them.  Coordinates in each ElkNode's
    // edges array are relative to that node, so we accumulate the absolute
    // offset as we descend (identical bookkeeping to drawNode above).
    //
    // Backward (feedback) edges: ELK's ORTHOGONAL routing for a right-to-left
    // edge produces a rectangular U-shape that visually merges with the
    // corresponding forward edge into a closed rectangle.  We detect feedback
    // edges (endPoint.x significantly left of startPoint.x) and replace ELK's
    // waypoints with a smooth cubic bezier arc that arcs above the diagram.
    const drawEdgesInNode = (n: ElkNode, ox: number, oy: number) => {
        const ax = ox + (n.x ?? 0), ay = oy + (n.y ?? 0);
        for (const e of n.edges ?? []) {
            // Initial-marker edges are drawn deterministically below — ELK's
            // routing of the tiny start node leaves them invisible.
            if (e.sources[0]?.startsWith('start_')) { continue; }
            const s = e.sections?.[0];
            if (!s) { continue; }

            const sx = ax + s.startPoint.x, sy = ay + s.startPoint.y;
            const ex = ax + s.endPoint.x,   ey = ay + s.endPoint.y;

            let d: string;
            let lblCx: number, lblCy: number; // label centre
            if (ex < sx - 20) {
                // Feedback (backward) edge — ELK's ORTHOGONAL routing produces
                // a rectangular U-shape; replace with a bezier arc above the
                // diagram.  Use node geometry so the arc joins state borders
                // precisely: exit source LEFT-center, enter target RIGHT-center.
                const srcG = geom.get(e.sources[0]);
                const tgtG = geom.get(e.targets[0]);
                const arcSx = srcG ? srcG.x           : sx;
                const arcSy = srcG ? srcG.y + srcG.h / 2 : sy;
                const arcEx = tgtG ? tgtG.x + tgtG.w  : ex;
                const arcEy = tgtG ? tgtG.y + tgtG.h / 2 : ey;
                const arcH = Math.max(40, Math.abs(arcSx - arcEx) * 0.32);
                // Cubic bezier: depart straight up from source, arrive straight
                // down at target — gives consistent arrowhead direction.
                d = `M ${arcSx} ${arcSy} C ${arcSx} ${arcSy - arcH} ${arcEx} ${arcEy - arcH} ${arcEx} ${arcEy}`;
                lblCx = (arcSx + arcEx) / 2;
                lblCy = (arcSy + arcEy) / 2 - arcH * 0.75;
            } else {
                const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
                d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${ax + p.x} ${ay + p.y}`).join(' ');
                lblCx = (sx + ex) / 2;
                lblCy = (sy + ey) / 2;
            }
            gEdges.appendChild(el('path', { d, fill: 'none', stroke: C.fg, 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'marker-end': 'url(#arrow)' }));

            const lbl = e.labels?.[0];
            if (lbl && lbl.text) {
                const lw = lbl.width ?? Math.ceil(textWidth(lbl.text, 11)) + 10;
                const lh = lbl.height ?? 16;
                // Use arc midpoint for feedback edges (ELK's label position is on
                // the rectangular path we discarded); ELK's position for others.
                const lx = ex < sx - 20 ? lblCx - lw / 2
                    : ax + (lbl.x ?? s.startPoint.x + (s.endPoint.x - s.startPoint.x) / 2 - lw / 2);
                const ly = ex < sx - 20 ? lblCy - lh / 2
                    : ay + (lbl.y ?? s.startPoint.y + (s.endPoint.y - s.startPoint.y) / 2 - lh / 2);
                const g = el('g', { 'data-event': lbl.text });
                (g as SVGElement).style.cursor = 'pointer';
                g.appendChild(el('rect', { x: lx - 3, y: ly - 1, width: lw + 6, height: lh + 2, rx: 4, ry: 4, fill: C.bg, 'fill-opacity': 0.9 }));
                g.appendChild(text(lbl.text, lx + lw / 2, ly + lh - 4, { 'text-anchor': 'middle', 'font-size': 11, fill: C.desc }));
                gLabels.appendChild(g);
            }
        }
        for (const c of n.children ?? []) { drawEdgesInNode(c, ax, ay); }
    };
    // Same initial y-offset as drawNode so edge coordinates stay aligned.
    drawEdgesInNode(result, 0, ARC_PAD);

    // Initial-state arrows: filled dot → initial substate, routed orthogonally
    // from the geometry ELK reserved for the start marker.
    for (const e of payload.edges) {
        if (!e.data.source.startsWith('start_')) { continue; }
        const sg = geom.get(e.data.source);
        const tg = geom.get(e.data.target);
        if (!sg || !tg) { continue; }
        const sx = sg.x + sg.w / 2, sy = sg.y + sg.h / 2;
        const tx2 = tg.x, ty2 = tg.y + tg.h / 2;
        const midX = (sx + tx2) / 2;
        const d = Math.abs(sy - ty2) < 1
            ? `M ${sx} ${sy} L ${tx2} ${ty2}`
            : `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty2} L ${tx2} ${ty2}`;
        gEdges.appendChild(el('path', { d, fill: 'none', stroke: C.fg, 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'marker-end': 'url(#arrow)' }));
    }

    if (!didFit) { fitToScreen(); didFit = true; }
    applyTransform();
}

// ── Interaction (delegated; survives re-render) ─────────────────────────────
let panMoved = false;
container.addEventListener('click', (ev) => {
    if (panMoved) { return; }
    const target = ev.target as Element;
    const labelG = target.closest('[data-event]');
    if (labelG) {
        vscode.postMessage({ command: 'eventClicked', eventName: labelG.getAttribute('data-event') });
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

// Pan / zoom.
container.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = container.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.min(3, Math.max(0.15, scale * factor));
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
container.addEventListener('pointerup', () => { dragging = false; });
container.addEventListener('pointerleave', () => { dragging = false; });

window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    if (message && message.command === 'highlight') {
        for (const rect of nameToRect.values()) {
            rect.setAttribute('fill', C.nodeBg);
            rect.setAttribute('stroke', C.fg);
        }
        const hit = nameToRect.get(message.stateId);
        if (hit) { hit.setAttribute('fill', C.selBg); hit.setAttribute('stroke', C.focus); }
    }
});

function showError(err: unknown): void {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    container.replaceChildren();
    const pre = document.createElement('pre');
    pre.textContent = `Failed to render statechart:\n\n${msg}`;
    pre.style.cssText = 'padding:16px;color:var(--vscode-errorForeground);white-space:pre-wrap;font-family:var(--vscode-editor-font-family);font-size:12px;';
    container.appendChild(pre);
    console.error('[xstate graph]', err);
}

// ── Export helpers ──────────────────────────────────────────────────────────
function exportSvg(): void {
    const svgEl = container.querySelector('svg');
    if (!svgEl) { return; }
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(cw));
    clone.setAttribute('height', String(ch));
    clone.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    const data = new XMLSerializer().serializeToString(clone);
    vscode.postMessage({ command: 'exportSvg', data });
}

function exportPng(): void {
    const svgEl = container.querySelector('svg');
    if (!svgEl) { return; }
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(cw));
    clone.setAttribute('height', String(ch));
    clone.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    const svgStr = new XMLSerializer().serializeToString(clone);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
    const canvas = document.createElement('canvas');
    canvas.width = cw * 2; canvas.height = ch * 2;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        vscode.postMessage({ command: 'exportPng', data: canvas.toDataURL('image/png') });
    };
    img.src = dataUrl;
}

// ── Toolbar buttons ─────────────────────────────────────────────────────────
function zoomAround(factor: number) {
    const cx = container.clientWidth / 2, cy = container.clientHeight / 2;
    const ns = Math.min(3, Math.max(0.15, scale * factor));
    tx = cx - ((cx - tx) / scale) * ns;
    ty = cy - ((cy - ty) / scale) * ns;
    scale = ns;
    applyTransform();
}
document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomAround(1.25));
document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomAround(1 / 1.25));
document.getElementById('btn-fit')?.addEventListener('click', fitToScreen);
document.getElementById('btn-export-svg')?.addEventListener('click', exportSvg);
document.getElementById('btn-export-png')?.addEventListener('click', exportPng);

render().catch(showError);
