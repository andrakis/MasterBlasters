// vm-gate.mjs -- the rules VM in the real game, on a real GPU box over CDP
// (never headless): start a bot match, wait for the void to collect someone,
// pull the rules frame log from the worker, and hand it to verify-round.
//
//   node tools/vm-gate.mjs [--cdp http://127.0.0.1:9224] [--url https://5182.code.home.stargazer.onl] [--seconds 40]

import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = ['/home/code/git/Breach/node_modules/playwright/index.mjs', fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url))].find((p) => existsSync(p));
const { chromium } = await import(pathToFileURL(PW).href);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CDP = arg('--cdp', 'http://127.0.0.1:9224');
const URL_BASE = arg('--url', 'https://5182.code.home.stargazer.onl');
const SECONDS = Number(arg('--seconds', '40'));
const out = fileURLToPath(new URL('../test/fixtures/last-round.json', import.meta.url));

const version = await fetch(`${CDP}/json/version`).then((r) => r.json()).catch(() => null);
if (!version) { console.error(`CDP at ${CDP} does not answer; stop.`); process.exit(2); }
console.log(`browser: ${version.Browser}`);
const browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 760 });
await page.bringToFront();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.error('CONSOLE ERROR:', m.text()); } });
let closed = false;
const cleanup = async () => { if (closed) return; closed = true; try { await page.close(); } catch {} try { await browser.close(); } catch {} };
process.on('unhandledRejection', async (e) => { console.error(e); await cleanup(); process.exit(1); });

await page.goto(`${URL_BASE}/?map=mb_columns`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__mbCmd && window.__mbProbe', null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /start|fight|play/i.test(x.textContent)); if (b) b.click(); });
await page.waitForFunction('(() => { const p = window.__mbProbe(); return p && p.matchLive; })()', null, { timeout: 30000 });
// one bot, two stocks: every round is decided by the dummy's own falls, and
// three lost rounds end the match — the whole rules surface in under two minutes
await page.evaluate(() => window.__mbCmd({ type: 'config', mapId: 'mb_columns', mode: 'lms', lives: 2, botCount: 1, botTier: 1, seed: 4242 }));
await page.waitForTimeout(500);
// The human dummy walks east for the rest of the match: off the deck, into the
// void, respawn, repeat — every stock costs a FALL frame, and losing them all
// ends the round (a ROUND_START follows). The renderer only sends commands while
// pointer-locked, so this one persists in the sim's humanCmds.
await page.evaluate(() => window.__mbCmd({ type: 'input', playerId: 0, cmd: { seq: 1, buttons: 0, moveX: 1, moveZ: 0, yaw: 0, pitch: 0, weapon: -1 } }));
console.log('match live; the dummy walks off the deck; waiting for falls…');
const t0 = Date.now();
let log = null;
while (Date.now() - t0 < SECONDS * 1000) {
  await page.waitForTimeout(2000);
  log = await page.evaluate('window.__mbRoundLog()');
  const falls = log.frames.filter((f) => f.type === 3).length;
  const probe = await page.evaluate('window.__mbProbe()');
  process.stdout.write(`  t+${((Date.now() - t0) / 1000).toFixed(0)}s frames ${log.frames.length} falls ${falls} tick ${probe.tick}\n`);
  if (log.replies.some((r) => r.type === 18 && r.payload[4] === 1)) break; // a VERDICT with matchover
}
const falls = log.frames.filter((f) => f.type === 3).length;
const verdicts = log.replies.filter((r) => r.type === 18).length;
writeFileSync(out, JSON.stringify(log));
console.log(`round log: ${log.frames.length} frames (${falls} falls), ${log.replies.length} replies (${verdicts} verdicts) -> test/fixtures/last-round.json`);
await cleanup();

let verify = '';
try { verify = execFileSync('node', [fileURLToPath(new URL('./verify-round.mjs', import.meta.url)), out, '--native'], { encoding: 'utf8' }); }
catch (e) { verify = (e.stdout ?? '') + (e.stderr ?? ''); }
console.log(verify.trim());
const rounds = log.frames.filter((f) => f.type === 2).length;
const matchOver = log.replies.some((r) => r.type === 18 && r.payload[4] === 1);
const ok = errors.length === 0 && falls >= 2 && rounds >= 2 && matchOver && /^VERIFIED/m.test(verify);
console.log(ok ? `VM GATE OK (${falls} falls, ${rounds} rounds, match over, verified)` : `VM GATE FAILED (${errors.length} errors, ${falls} falls, ${rounds} rounds, matchOver ${matchOver})`);
process.exit(ok ? 0 : 1);
