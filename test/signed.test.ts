// The shipped VM images are signed with the game's release key, and the loader
// path the worker uses refuses a tampered one. (The helper strips trailers
// without verifying: node trusts its own working tree; the browser does not.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedImage } from '../src/rules/vmRules.ts';
import { RELEASE_KEYS } from '../src/rules/releaseKey.ts';
import { splitSigned } from '../vendor/coreframe/sign.js';

const base = new URL('../public/coreframe/', import.meta.url);
const bytes = (n: string) => new Uint8Array(readFileSync(new URL(n, base)));

test('a release key is configured and both images are signed with it', async () => {
  assert.ok(Object.keys(RELEASE_KEYS).length >= 1);
  for (const n of ['fw.c4r', 'mb_rules.c4r']) {
    const b = bytes(n);
    const { keyId } = splitSigned(b);
    assert.ok(keyId && RELEASE_KEYS[keyId], `${n} carries a trusted key id (${keyId})`);
    const img = await verifiedImage(b, n);
    assert.ok(img.length < b.length);
  }
});

test('a tampered image is refused before it can boot', async () => {
  const b = bytes('mb_rules.c4r');
  b[200] ^= 0x10;
  await assert.rejects(verifiedImage(b, 'mb_rules.c4r'), /bad signature/);
  const { image } = splitSigned(bytes('mb_rules.c4r'));
  await assert.rejects(verifiedImage(image, 'mb_rules.c4r'), /unsigned image/);
});
