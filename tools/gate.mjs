#!/usr/bin/env node
// The browser gate: play a real round in a real browser and check the game did its job.
//
//   node tools/gate.mjs [--cdp http://127.0.0.1:9224] [--url https://5182.code.home.stargazer.onl]
//                       [--map mb_egyptarena] [--seconds 40]
//
// CDP ONLY, never headless: this box has no GPU and SwiftShader has no WebGPU. 9224 is the
// desktop with the 3060 Ti, 9222 the Chromebook; both reach the dev server through the
// code-server proxy. Any pageerror or console error fails the run.
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CDP = arg('--cdp', process.env.MB_CDP ?? 'http://127.0.0.1:9224');
const URL_BASE = arg('--url', process.env.MB_URL ?? 'https://5182.code.home.stargazer.onl');
const MAP = arg('--map', 'mb_egyptarena');
const SECONDS = Number(arg('--seconds', 40));

const PW = ['./node_modules/playwright/index.mjs', '/home/code/git/Breach/node_modules/playwright/index.mjs'].find((p) => existsSync(p));
if (!PW) { console.error('no playwright checkout found'); process.exit(2); }
const { chromium } = await import(pathToFileURL(PW).href);

const version = await fetch(`${CDP}/json/version`).then((r) => r.json()).catch(() => null);
if (!version) { console.error(`CDP at ${CDP} does not answer. The tunnel is down — stop here.`); process.exit(2); }
console.log(`browser: ${version.Browser}`);

const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 760 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.error('CONSOLE ERROR:', m.text()); } });
const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const cleanup = async () => { try { await page.close(); } catch { /* gone */ } try { await browser.close(); } catch { /* detached */ } };
process.on('unhandledRejection', async (e) => { console.error(e); await cleanup(); process.exit(1); });

await page.goto(`${URL_BASE}/?map=${MAP}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__mbCmd && window.__mbProbe', null, { timeout: 30000 });
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /start|fight|play/i.test(x.textContent)); if (b) b.click(); });
await page.evaluate((map) => window.__mbCmd({ type: 'config', mapId: map, mode: 'lms', lives: 2, botCount: 1, botTier: 1, seed: 4242 }), MAP);
await page.waitForTimeout(3000);

const first = await page.evaluate('window.__mbProbe()');
check(first.mapId === MAP, `?map= opened ${MAP}`);
check(first.names.length >= 2, `the match is seeded and named (${first.names.join(', ')})`);

// the recovered geometry and its 3D skybox
const scene = await page.evaluate('window.__mbScene ? JSON.stringify(window.__mbScene()) : null');
const s = scene ? JSON.parse(scene) : null;
check(!!s, 'the render scene answers');
if (s?.sky) check(s.sky.tris > 1000 && s.sky.depthTest === false && s.sky.fog === false,
  `the 3D skybox is drawn as a backdrop (${s.sky.tris} tris, no depth, no fog)`);

// walk off the deck until somebody loses a life: the sim scores its own rounds
const t0 = Date.now();
let last = first;
while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.evaluate((k) => window.__mbCmd({ type: 'input', playerId: 0, cmd: { seq: k, buttons: 0, moveX: 1, moveZ: 0, yaw: 2.2, pitch: 0, weapon: -1 } }), Date.now() & 0xffff);
  await page.waitForTimeout(250);
  last = await page.evaluate('window.__mbProbe()');
  if (last.scores.some((p) => p.falls > 0) && last.scores.some((p) => p.lives < 2)) break;
}
check(last.tick > first.tick, `the sim ran (tick ${first.tick} -> ${last.tick})`);
const falls = last.scores.reduce((n, p) => n + p.falls, 0);
check(falls > 0, `somebody fell (${falls})`);
check(last.scores.some((p) => p.lives < 2), `and it cost a life (${last.scores.map((p) => p.lives).join('/')})`);
check(errors.length === 0, `no page or console errors (${errors.length})`);

await cleanup();
console.log(fails.length === 0 ? 'GATE OK' : `GATE FAILED (${fails.length}: ${fails.join(' | ')})`);
process.exit(fails.length === 0 ? 0 : 1);
