#!/usr/bin/env node
// verify-round.mjs -- the server's side of the black box: replay a client's
// rules frame log through the same VM image and check its claimed replies.
//
//   node tools/verify-round.mjs round.json [--native]
//
// round.json is what window.__mbRoundLog() returns in a DEV build:
//   { "frames": [{type, payload:[...]}...], "replies": [{type, payload:[...]}...] }
// The frames are replayed on the node host (the vendored c4bb sim, byte for
// byte what the browser ran); the replies must match. --native additionally
// runs the log through native c4m32 (test/fixtures/mb_rules_native.c4r).
// VERIFIED exit 0 · MISMATCH exit 1 · unusable input / missing toolchain exit 2.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../vendor/coreframe/host.js';

const file = process.argv[2];
if (!file) { console.error('usage: verify-round.mjs round.json [--native]'); process.exit(2); }
const round = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(round.frames) || !Array.isArray(round.replies)) { console.error('verify-round: need {frames, replies}'); process.exit(2); }

const pub = fileURLToPath(new URL('../public/coreframe/', import.meta.url));
const host = createHost({
  ucSource: readFileSync(join(pub, 'microcode.uc'), 'utf8'),
  fwBytes: new Uint8Array(readFileSync(join(pub, 'fw.c4r'))),
  progBytes: new Uint8Array(readFileSync(join(pub, 'mb_rules.c4r'))),
  argv: ['mb_rules.c4r'],
});
const fmt = (f) => `${f.type}:${Array.from(f.payload).map((v) => ` ${v}`).join('')}`;
const replayed = [];
for (const f of round.frames) for (const r of host.exchange(f.type, f.payload)) replayed.push(fmt(r));
const claimed = round.replies.map(fmt);

let ok = replayed.length === claimed.length && replayed.every((l, i) => l === claimed[i]);
let verdict = ok ? 'VERIFIED' : 'MISMATCH';
if (!ok) {
  for (let i = 0; i < Math.max(replayed.length, claimed.length); i++) {
    if (replayed[i] !== claimed[i]) { console.log(`  reply ${i + 1}\n    replayed: ${replayed[i]}\n    claimed:  ${claimed[i]}`); break; }
  }
}

if (process.argv.includes('--native')) {
  const C4_ROOT = process.env.C4_ROOT ?? join(homedir(), 'git/c4');
  const img = fileURLToPath(new URL('../test/fixtures/mb_rules_native.c4r', import.meta.url));
  if (!existsSync(join(C4_ROOT, 'c4m32')) || !existsSync(img)) { console.log(`${verdict} (node host); NATIVE UNAVAILABLE`); process.exit(ok ? 2 : 1); }
  const words = [];
  for (const f of round.frames) words.push(f.type, f.payload.length, ...f.payload);
  words.push(0, 0);
  const dir = mkdtempSync(join(tmpdir(), 'mb-verify-'));
  let nativeLines;
  try {
    const log = join(dir, 'frames.bin');
    writeFileSync(log, Buffer.from(Int32Array.from(words).buffer));
    nativeLines = execFileSync(join(C4_ROOT, 'c4m32'), ['load-c4r.c', '--', img, log], { cwd: C4_ROOT, encoding: 'utf8', timeout: 120000 }).split('\n').filter((l) => /^\d+:/.test(l));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const nativeOk = nativeLines.length === claimed.length && nativeLines.every((l, i) => l === claimed[i]);
  console.log(`native c4m32: ${nativeOk ? 'agrees' : 'DISAGREES'} (${nativeLines.length} replies)`);
  ok = ok && nativeOk;
  verdict = ok ? 'VERIFIED' : 'MISMATCH';
}

console.log(`${verdict}: ${round.frames.length} frames, ${claimed.length} claimed replies, ${host.cycle()} guest cycles`);
process.exit(ok ? 0 : 1);
