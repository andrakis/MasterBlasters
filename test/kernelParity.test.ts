// The rules under C4KE (what a DEV build runs, with the console) answer exactly as the
// bare host does: the same unit, linked with cf_kmain.c instead of cf_main.c. The
// replay verifier is bare, so this is what lets a round played under the kernel verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testKernelRules, testRules } from './helpers.ts';
import { SCENARIOS, type F } from './scenarios.ts';

const fmt = (type: number, p: ArrayLike<number>) => `${type}:${Array.from(p).map((v) => ` ${v}`).join('')}`;
const replies = (rules: ReturnType<typeof testRules>, frames: F[]) => {
  const out: string[] = [];
  for (const f of frames) { rules.breathe(20000); for (const r of rules.host.exchange(f.type, f.payload)) out.push(fmt(r.type, r.payload)); }
  return out;
};

for (const [name, frames] of Object.entries(SCENARIOS)) {
  test(`kernel parity: ${name}`, () => {
    const bare = testRules(), kernel = testKernelRules();
    try {
      const a = replies(bare, frames), b = replies(kernel, frames);
      assert.ok(a.length > 0);
      assert.deepEqual(b, a);
    } finally { bare.dispose(); kernel.dispose(); }
  });
}

test('the shell is live beside the kernel-hosted rules: ps lists mb_rules_k.c4r, top can start', () => {
  const rules = testKernelRules();
  try {
    assert.ok(rules.kernel, 'hosted under C4KE');
    rules.takeConsole();
    rules.console('ps\n');
    rules.breathe(5e6);
    const out = rules.takeConsole();
    assert.match(out, /mb_rules_k\.c4r/);
    assert.match(out, /c4sh>\s*$/);
    rules.console('top -d 100 &\n');
    rules.breathe(5e6);
    for (let i = 0; i < 20; i++) { rules.breathe(300000); rules.host.exchange(6, [i]); }
    assert.match(rules.takeConsole(), /PID PPID/, 'top drew beside the frames');
  } finally { rules.dispose(); }
});
