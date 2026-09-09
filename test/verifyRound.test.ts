// A round recorded from the real game on the GPU box (tools/vm-gate.mjs writes
// test/fixtures/last-round.json) must verify on the node host: the same frames
// through the same image give the same replies. A tampered reply must not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/last-round.json', import.meta.url));
const verifier = fileURLToPath(new URL('../tools/verify-round.mjs', import.meta.url));
const present = existsSync(fixture);

function run(file: string): { code: number; out: string } {
  try { return { code: 0, out: execFileSync('node', [verifier, file], { encoding: 'utf8' }) }; }
  catch (e) { const err = e as { status: number; stdout: string }; return { code: err.status, out: err.stdout }; }
}

test('the recorded round verifies on the node host', { skip: !present && 'no recorded round' }, () => {
  const r = run(fixture);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^VERIFIED/m);
});

test('a tampered verdict is a MISMATCH', { skip: !present && 'no recorded round' }, () => {
  const round = JSON.parse(readFileSync(fixture, 'utf8'));
  const v = round.replies.findLast((x: { type: number }) => x.type === 18);
  assert.ok(v, 'the round has a verdict');
  v.payload[16] += 1; // player 0's lives, one more than earned
  const dir = mkdtempSync(join(tmpdir(), 'mb-tamper-'));
  try {
    const f = join(dir, 'round.json');
    writeFileSync(f, JSON.stringify(round));
    const r = run(f);
    assert.equal(r.code, 1);
    assert.match(r.out, /^MISMATCH/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
