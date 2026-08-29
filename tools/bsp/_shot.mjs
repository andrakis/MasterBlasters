// Headless capture for the BSP viewer. Usage:
//   node tools/bsp/_shot.mjs <out.png> '[[px,py,pz],[lx,ly,lz]]' '{"textures":false}'
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [out = '/tmp/shot.png', camArg, togArg, map = 'mb_columns'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
const url = map.startsWith('model:')
  ? `http://localhost:5181/bspview.html?model=${map.slice(6)}`
  : `http://localhost:5181/bspview.html?map=${map}`;
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForFunction(() => window.__bspScene, null, { timeout: 30000 });
await p.waitForTimeout(2500);
if (togArg) { await p.evaluate((t) => window.__bspToggles(JSON.parse(t)), togArg); await p.waitForTimeout(600); }
if (camArg) {
  await p.evaluate((c) => { const [pos, look] = JSON.parse(c); window.__bspLook(...pos, ...look); }, camArg);
  await p.waitForTimeout(1200);
}
if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 10).join('\n'));
const s = await p.context().newCDPSession(p);
const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('wrote', out);
await b.close();
