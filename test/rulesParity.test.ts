// The rules core is ONE source that runs on two hosts: the c4bb VM through
// the mailbox (what the game ships) and native c4m32 through a frame log
// (test/fixtures/mb_rules_native.c4r). Every reply must be identical, and the
// stream seeds must match what the game's old deriveSeed produced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRules } from './helpers.ts';
import { FRAME } from '../src/rules/frames.ts';

const C4_ROOT = process.env.C4_ROOT ?? join(homedir(), 'git/c4');
const nativeImage = fileURLToPath(new URL('./fixtures/mb_rules_native.c4r', import.meta.url));
const haveNative = existsSync(join(C4_ROOT, 'c4m32')) && existsSync(nativeImage);
if (!haveNative) console.error(`rulesParity: native leg SKIPPED (needs ${C4_ROOT}/c4m32 and ${nativeImage})`);

type F = { type: number; payload: number[] };
const SCENARIOS: Record<string, F[]> = {
  'team mode, KO credit, elimination, a second round': [
    { type: FRAME.MATCH_START, payload: [12345, 1, 2, 3, 300, 8, 4, 0, 1, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [100, 1, 0, 90] }, { type: FRAME.TICK_END, payload: [100] },
    { type: FRAME.SPAWN, payload: [220, 1] },
    { type: FRAME.FALL, payload: [300, 3, 0, 299] }, { type: FRAME.FALL, payload: [300, 1, -1, 0] }, { type: FRAME.TICK_END, payload: [300] },
    { type: FRAME.FALL, payload: [400, 3, 2, 50] }, { type: FRAME.TICK_END, payload: [400] },
    { type: FRAME.FALL, payload: [450, 1, 0, 449] }, { type: FRAME.TICK_END, payload: [450] },
    { type: FRAME.ROUND_START, payload: [2] },
  ],
  'timed mode: timer tie -> sudden death -> a respawn decides': [
    { type: FRAME.MATCH_START, payload: [31337, 2, 1, 3, 300, 4, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [10, 0, 1, 5] }, { type: FRAME.TICK_END, payload: [10] },
    { type: FRAME.TIMER, payload: [18000] },
    { type: FRAME.SPAWN, payload: [18010, 0] }, { type: FRAME.TICK_END, payload: [18010] },
  ],
  'two falls on one tick both cost a stock, then a draw': [
    { type: FRAME.MATCH_START, payload: [1, 0, 1, 3, 300, 8, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [50, 0, 1, 49] }, { type: FRAME.FALL, payload: [50, 1, 0, 49] }, { type: FRAME.TICK_END, payload: [50] },
  ],
  'three round wins end the match': [
    { type: FRAME.MATCH_START, payload: [555, 0, 1, 3, 300, 8, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] }, { type: FRAME.FALL, payload: [10, 1, 0, 9] }, { type: FRAME.TICK_END, payload: [10] },
    { type: FRAME.ROUND_START, payload: [2] }, { type: FRAME.FALL, payload: [20, 1, 0, 19] }, { type: FRAME.TICK_END, payload: [20] },
    { type: FRAME.ROUND_START, payload: [3] }, { type: FRAME.FALL, payload: [30, 1, 0, 29] }, { type: FRAME.TICK_END, payload: [30] },
  ],
};

const fmt = (type: number, p: ArrayLike<number>) => `${type}:${Array.from(p).map((v) => ` ${v}`).join('')}`;

function viaVm(frames: F[]): string[] {
  const rules = testRules();
  const out: string[] = [];
  for (const f of frames) for (const r of rules.host.exchange(f.type, f.payload)) out.push(fmt(r.type, r.payload));
  rules.dispose();
  return out;
}

function viaNative(frames: F[]): string[] {
  const words: number[] = [];
  for (const f of frames) words.push(f.type, f.payload.length, ...f.payload);
  words.push(0, 0);
  const dir = mkdtempSync(join(tmpdir(), 'mb-parity-'));
  try {
    const log = join(dir, 'frames.bin');
    writeFileSync(log, Buffer.from(Int32Array.from(words).buffer));
    const out = execFileSync(join(C4_ROOT, 'c4m32'), ['load-c4r.c', '--', nativeImage, log], { cwd: C4_ROOT, encoding: 'utf8', timeout: 120000 });
    return out.split('\n').filter((l) => /^\d+:/.test(l));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [name, frames] of Object.entries(SCENARIOS)) {
  test(`parity: ${name}`, { skip: !haveNative && 'native toolchain missing' }, () => {
    const a = viaVm(frames), b = viaNative(frames);
    assert.ok(a.length > 0);
    assert.deepEqual(a, b);
  });
}

test('stream seeds match the game\'s former deriveSeed (goldens)', () => {
  const golden: [number, number[]][] = [
    [12345, [-226969851, -2026253812, 712539786]],
    [31337, [1879889975, 91598499, 1034245050]],
    [1, [920564995, 314344336, 697614773]],
    [-1314554350, [113165271, 1393648737, -1899455306]],
  ];
  for (const [seed, want] of golden) {
    const rules = testRules();
    const { streams } = rules.matchStart({ seed, mode: 0, lives: 4, roundsToWin: 3, koCreditTicks: 300, spots: 8, teams: [0, 1] });
    assert.deepEqual(streams, want, `seed ${seed}`);
    rules.dispose();
  }
});

test('the VM is deterministic: the same frames cost the same cycles', () => {
  const run = () => { const r = testRules(); for (const f of SCENARIOS['team mode, KO credit, elimination, a second round']) r.host.exchange(f.type, f.payload); const c = r.cycles(); r.dispose(); return c; };
  assert.equal(run(), run());
});
