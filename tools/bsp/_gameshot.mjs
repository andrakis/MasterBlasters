// Drive the real game onto a map and capture it (CLAUDE.md: look at a screenshot).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const [out = '/tmp/g.png', mapId = 'mb_columns'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:5181/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1500);
// pick the map in the menu, then start
const picked = await p.evaluate((id) => {
  const btns = [...document.querySelectorAll('.opt')];
  const want = btns.find((b) => b.textContent.trim().toUpperCase().includes(id.replace('mb_', '').toUpperCase()));
  if (want) { want.click(); return want.textContent.trim(); }
  return null;
}, mapId);
console.log('picked map button:', picked);
await p.waitForTimeout(400);
await p.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => /start|fight|play/i.test(b.textContent));
  if (start) start.click();
});
await p.waitForTimeout(2500);
// Keyboard only — headless pointer lock is unreliable. 'c' toggles the
// third-person camera, which pulls back far enough to read the arena.
const keys = (process.argv[5] ?? '').split(',').filter(Boolean);
for (const k of keys) {
  if (k.startsWith('hold:')) {
    const [, key, ms] = k.split(':');
    await p.keyboard.down(key);
    await p.waitForTimeout(Number(ms));
    await p.keyboard.up(key);
  } else {
    await p.keyboard.press(k);
    await p.waitForTimeout(300);
  }
}
await p.waitForTimeout(1500);
const cam = await p.evaluate(() => window.__mbCam ?? null);
console.log('cam:', JSON.stringify(cam));
if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 10).join('\n'));
const s = await p.context().newCDPSession(p);
const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('wrote', out);
await b.close();
