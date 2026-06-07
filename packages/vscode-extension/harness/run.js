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
    </style></head><body>
      <div id="cy"></div>
      <button id="btn-direction" style="display:none"></button>
      <button id="btn-zoom-in" style="display:none"></button>
      <button id="btn-zoom-out" style="display:none"></button>
      <button id="btn-fit" style="display:none"></button>
      <button id="btn-expand-all" style="display:none"></button>
      <button id="btn-collapse-all" style="display:none"></button>
      <button id="btn-export-svg" style="display:none"></button>
      <button id="btn-export-png" style="display:none"></button>
      <script>
        window.acquireVsCodeApi = () => ({ postMessage: (m) => console.log('post', JSON.stringify(m)) });
        window.__GRAPH__ = ${payload};
        window.__DIRECTION__ = ${JSON.stringify(direction)};
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
        // COLLAPSE_ALL=1 clicks the collapse-all toolbar button after render.
        if (${JSON.stringify(process.env.COLLAPSE_ALL || '')}) {
          setTimeout(() => document.getElementById('btn-collapse-all').click(), 300);
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
