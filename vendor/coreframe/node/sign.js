#!/usr/bin/env node
// node/sign.js - the LOCAL signer (the service, M5, is the real one).
//
//   node runtime/node/sign.js keygen <keyfile>               write an Ed25519 keypair (PEM, private!) + <keyfile>.pub (raw 32 bytes, hex)
//   node runtime/node/sign.js sign <keyfile> <in.c4r> <out.c4r>
//   node runtime/node/sign.js verify <keyfile>.pub <image.c4r>
//   node runtime/node/sign.js keyid <keyfile>.pub
//
// The signature covers the image bytes; the trailer is runtime/sign.js's.

import { generateKeyPairSync, createPrivateKey, sign as edSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { attachSignature, keyIdOf, verifyImage, splitSigned } from '../sign.js';

const [cmd, ...a] = process.argv.slice(2);
const rawPub = (hexFile) => Uint8Array.from(Buffer.from(readFileSync(hexFile, 'utf8').trim(), 'hex'));

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(a[0], privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  // raw 32-byte public key = the last 32 bytes of the SPKI DER
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const raw = spki.subarray(spki.length - 32);
  writeFileSync(`${a[0]}.pub`, raw.toString('hex') + '\n');
  console.log(`keygen: ${a[0]} (private, keep it out of the repo), ${a[0]}.pub (key id ${await keyIdOf(raw)})`);
} else if (cmd === 'sign') {
  const [keyfile, inFile, outFile] = a;
  const priv = createPrivateKey(readFileSync(keyfile));
  const raw = rawPub(`${keyfile}.pub`);
  const image = new Uint8Array(readFileSync(inFile));
  const { image: bare } = splitSigned(image);   // re-signing replaces an old trailer
  const sig = new Uint8Array(edSign(null, bare, priv));
  const keyId = await keyIdOf(raw);
  writeFileSync(outFile, attachSignature(bare, keyId, sig));
  console.log(`sign: ${outFile} (${bare.length} bytes + trailer, key ${keyId})`);
} else if (cmd === 'verify') {
  const raw = rawPub(a[0]);
  const keyId = await keyIdOf(raw);
  const r = await verifyImage(new Uint8Array(readFileSync(a[1])), { [keyId]: raw });
  console.log(`verify: ${a[1]}: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'keyid') {
  console.log(await keyIdOf(rawPub(a[0])));
} else {
  console.error('usage: sign.js keygen <keyfile> | sign <keyfile> <in> <out> | verify <keyfile>.pub <image> | keyid <keyfile>.pub');
  process.exit(2);
}
