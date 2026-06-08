// Harness driver: bundle the payload generator + the real webview graph.js,
// generate a payload from a fixture, write a standalone HTML page, and
// screenshot it with headless Chrome.
//
//   node harness/run.js <fixture.ts> [machineIndex] [DOWN|RIGHT] [outName]
//
// Output: harness/out/<outName>.png  and  harness/out/<outName>.html
const esbuild = require('esbuild');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const fixture = process.argv[2] || path.join(HERE, '..', 'testing', 'checkout.machine.ts');
const machineIndex = process.argv[3] || '0';
const direction = (process.argv[4] || 'DOWN').toUpperCase();
const outName = process.argv[5] || 'graph';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
    // 1) Bundle the payload generator (node, vscode → shim).
    await esbuild.build({
        entryPoints: [path.join(HERE, 'gen-payload.ts')],
        bundle: true, outfile: path.join(OUT, 'gen-payload.js'),
        platform: 'node', format: 'cjs', target: 'node16',
        alias: { vscode: path.join(HERE, 'vscode-shim.js') },
        logLevel: 'warning',
    });

    // 2) Bundle the REAL webview graph.ts (same options as esbuild.js).
    await esbuild.build({
        entryPoints: [path.join(HERE, '..', 'src', 'webview', 'graph.ts')],
        bundle: true, outfile: path.join(OUT, 'graph.js'),
        platform: 'browser', format: 'iife', target: 'es2020',
        logLevel: 'warning',
    });

    // 3) Generate the payload.
    const payload = execFileSync('node', [path.join(OUT, 'gen-payload.js'), fixture, machineIndex], { encoding: 'utf8' });

    // 4) Write the standalone HTML page (acquireVsCodeApi stubbed; toolbar ids present).
    const graphJs = fs.readFileSync(path.join(OUT, 'graph.js'), 'utf8');
    const html = `<!doctype html><html><head><meta charset="utf8"><style>
      :root { color-scheme: light; }
      body { margin:0; font-family: system-ui, sans-serif;
             --vscode-editor-foreground:#1f1f1f; --vscode-editor-background:#ffffff;
             --vscode-editorWidget-background:#f3f3f3; --vscode-focusBorder:#0090f1;
             --vscode-list-activeSelectionBackground:#cce5ff; --vscode-descriptionForeground:#717171;
             --vscode-charts-blue:#3b82f6; --vscode-font-family: system-ui, sans-serif; }
      #cy { position:absolute; inset:0; background:var(--vscode-editor-background); }
      /* Real toolbar markup mirrored from graphView.getHtmlForWebview, so the
         harness exercises the actual toolbar wiring (button ids), not stubs. */
      #toolbar { position:absolute; bottom:12px; right:12px; z-index:10; display:flex;
        align-items:center; gap:1px; background:var(--vscode-editorWidget-background);
        border:1px solid rgba(127,127,127,0.3); border-radius:6px; padding:3px;
        box-shadow:0 2px 8px rgba(0,0,0,0.16); user-select:none; }
      #toolbar button { background:none; border:none; color:var(--vscode-editor-foreground);
        cursor:pointer; padding:4px 8px; border-radius:4px; font-size:12px;
        font-family:var(--vscode-font-family); line-height:1.4; white-space:nowrap; }
      #toolbar button:hover { background:rgba(127,127,127,0.1); }
      .tb-sep { width:1px; height:14px; background:rgba(127,127,127,0.3); margin:0 2px; }
    </style></head><body>
      <div id="cy"></div>
      <div id="toolbar">
        <button id="btn-zoom-in"  title="Zoom in">+</button>
        <button id="btn-zoom-out" title="Zoom out">−</button>
        <button id="btn-fit"      title="Fit to screen">⊡</button>
        <button id="btn-direction" title="Toggle layout direction">↧</button>
        <div class="tb-sep"></div>
        <button id="btn-expand-all"   title="Expand all states">⊞</button>
        <button id="btn-collapse-all" title="Collapse all states">⊟</button>
        <div class="tb-sep"></div>
        <button id="btn-export-svg" title="Export as SVG">SVG</button>
        <button id="btn-export-png" title="Export as PNG">PNG</button>
      </div>
      <script>
        window.acquireVsCodeApi = () => ({ postMessage: (m) => console.log('post', JSON.stringify(m)) });
        window.__GRAPH__ = ${payload};
        window.__DIRECTION__ = ${JSON.stringify(direction)};
        window.__SELECT__ = ${JSON.stringify(process.env.SELECT || '')};
      </script>
      <script>${graphJs}</script>
      <script>
        // Optional verification hook: after first render, click the INTERIOR
        // (not the border) of the region whose title matches CLICK_REGION, to
        // prove interior clicks now collapse a region.
        const CLICK = ${JSON.stringify(process.env.CLICK_REGION || '')};
        // KEYS="ArrowDown ArrowDown Enter" dispatches a keydown sequence on the
        // container (prefix a token with Shift+ for shiftKey). Drives keyboard nav.
        const KEYS = ${JSON.stringify(process.env.KEYS || '')};
        if (KEYS) {
          const cy = document.getElementById('cy');
          cy.focus();
          const toks = KEYS.split(/\\s+/).filter(Boolean);
          toks.forEach((tok, i) => setTimeout(() => {
            const shift = tok.startsWith('Shift+');
            const key = shift ? tok.slice(6) : tok;
            cy.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));
          }, 400 + i * 180));
        }
        // HIGHLIGHT=<sanitizedName> posts the host's cursor-sync message.
        if (${JSON.stringify(process.env.HIGHLIGHT || '')}) {
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
            data: { command: 'highlight', stateId: ${JSON.stringify(process.env.HIGHLIGHT || '')} },
          })), 500);
        }
        // HOVER=<name> dispatches mouseenter on the node group with that data-name.
        if (${JSON.stringify(process.env.HOVER || '')}) {
          setTimeout(() => {
            const g = document.querySelector('[data-name="' + ${JSON.stringify(process.env.HOVER || '')} + '"]');
            if (g) { g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); }
          }, 450);
        }
        // COLLAPSE_ALL=1 clicks the collapse-all toolbar button after render.
        if (${JSON.stringify(process.env.COLLAPSE_ALL || '')}) {
          setTimeout(() => document.getElementById('btn-collapse-all').click(), 300);
        }
        // CLICK_BTN=btn-direction clicks any real toolbar button by id.
        if (${JSON.stringify(process.env.CLICK_BTN || '')}) {
          setTimeout(() => document.getElementById(${JSON.stringify(process.env.CLICK_BTN || '')}).click(), 350);
        }
        // CLICK_TARGET=title (default) clicks the title-bar centre; =body clicks
        // the region's interior centre. Both go through REAL hit-testing
        // (elementFromPoint), so this validates pointer-events, not just dispatch.
        const CLICK_TARGET = ${JSON.stringify(process.env.CLICK_TARGET || 'title')};
        if (CLICK) {
          const tryClick = (tries) => {
            const cy = document.getElementById('cy');
            const regions = [...cy.querySelectorAll('[data-kind="region"]')];
            const g = regions.find(r => r.getAttribute('data-name') === CLICK);
            if (!g) { if (tries > 0) return setTimeout(() => tryClick(tries - 1), 100); else return; }
            const box = g.getBoundingClientRect();
            // Title bar sits at the top of the region; body is its middle.
            const px = box.left + box.width / 2;
            const py = CLICK_TARGET === 'body' ? box.top + box.height / 2 : box.top + 10;
            const hit = document.elementFromPoint(px, py);
            console.log('hit', CLICK_TARGET, hit && hit.tagName, hit && hit.getAttribute('fill'));
            if (hit) { hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: px, clientY: py })); }
          };
          setTimeout(() => tryClick(20), 300);
        }
      </script>
    </body></html>`;
    const htmlPath = path.join(OUT, `${outName}.html`);
    fs.writeFileSync(htmlPath, html);

    // 5) Screenshot with headless Chrome.
    const pngPath = path.join(OUT, `${outName}.png`);
    const r = spawnSync(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=2',
        '--window-size=1400,1000',
        '--virtual-time-budget=6000',
        `--screenshot=${pngPath}`,
        `file://${htmlPath}`,
    ], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stderr || r.stdout); }
    const n = JSON.parse(payload).nodes.length;
    console.log(`fixture=${path.basename(fixture)} idx=${machineIndex} dir=${direction} nodes=${n} → ${pngPath}`);
}
main().catch(e => { console.error(e); process.exit(1); });
