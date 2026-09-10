// vendored from CoreFrame/runtime/sign.js @ fcb900b -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// sign.js - the signature trailer on a .c4r image, and its verification.
//
// Every loader stops reading at a computed offset (docs/PLAN.md M3), so a
// signed image is the original bytes followed by a trailer nothing else
// reads:
//
//   ...image bytes...  'C4SG'  keyId(8 bytes)  signature(64 bytes, Ed25519)
//
// The signature covers the image bytes only (everything before the trailer).
// Verification runs on WebCrypto (browser and node 26 alike: Ed25519 is a
// native algorithm in both), takes a Map of keyId -> public key (raw 32-byte
// or SPKI bytes), and returns the bare image for the loader. A host that was
// given keys refuses an unsigned or mistrusted image; a host with no keys
// runs anything (development). The private key never leaves the signer:
// runtime/node/sign.js is the local one, the service (M5) the real one.

export const TRAILER_MAGIC = [0x43, 0x34, 0x53, 0x47];   // 'C4SG'
export const KEY_ID_BYTES = 8;
export const SIG_BYTES = 64;
export const TRAILER_BYTES = 4 + KEY_ID_BYTES + SIG_BYTES;

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

/** split a possibly-signed image: { image, keyId (hex) | null, signature | null } */
export function splitSigned(bytes) {
  const n = bytes.length;
  if (n > TRAILER_BYTES) {
    const t = n - TRAILER_BYTES;
    if (bytes[t] === TRAILER_MAGIC[0] && bytes[t + 1] === TRAILER_MAGIC[1] && bytes[t + 2] === TRAILER_MAGIC[2] && bytes[t + 3] === TRAILER_MAGIC[3]) {
      const keyId = Array.from(bytes.subarray(t + 4, t + 4 + KEY_ID_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
      return { image: bytes.subarray(0, t), keyId, signature: bytes.subarray(t + 4 + KEY_ID_BYTES, n) };
    }
  }
  return { image: bytes, keyId: null, signature: null };
}

/** the key id of a public key: the first 8 bytes of SHA-256 over its raw 32 bytes */
export async function keyIdOf(rawPublicKey) {
  const h = new Uint8Array(await subtle().digest('SHA-256', rawPublicKey));
  return Array.from(h.subarray(0, KEY_ID_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** raw 32-byte Ed25519 public key -> CryptoKey */
export async function importPublicKey(raw32) {
  return subtle().importKey('raw', raw32, { name: 'Ed25519' }, true, ['verify']);
}

/**
 * Verify a signed image against trusted keys ({ keyId -> raw 32-byte public key }).
 * Returns { ok, image, keyId, reason }. With an empty/absent key set the image is
 * returned unverified (ok: true, reason: 'no keys configured') -- development.
 */
export async function verifyImage(bytes, trustedKeys) {
  const { image, keyId, signature } = splitSigned(bytes);
  const keys = trustedKeys ? Object.keys(trustedKeys) : [];
  if (keys.length === 0) return { ok: true, image, keyId, reason: 'no keys configured' };
  if (!keyId) return { ok: false, image: null, keyId: null, reason: 'unsigned image' };
  const raw = trustedKeys[keyId];
  if (!raw) return { ok: false, image: null, keyId, reason: `untrusted key ${keyId}` };
  const key = await importPublicKey(raw);
  const good = await subtle().verify({ name: 'Ed25519' }, key, signature, image);
  return good ? { ok: true, image, keyId, reason: 'verified' } : { ok: false, image: null, keyId, reason: 'bad signature' };
}

/** append a trailer (the signature is computed by the caller; this only frames it) */
export function attachSignature(image, keyIdHex, signature) {
  if (signature.length !== SIG_BYTES) throw new Error(`signature must be ${SIG_BYTES} bytes`);
  const out = new Uint8Array(image.length + TRAILER_BYTES);
  out.set(image, 0);
  let p = image.length;
  out.set(TRAILER_MAGIC, p); p += 4;
  for (let i = 0; i < KEY_ID_BYTES; i++) out[p + i] = parseInt(keyIdHex.slice(i * 2, i * 2 + 2), 16);
  p += KEY_ID_BYTES;
  out.set(signature, p);
  return out;
}
