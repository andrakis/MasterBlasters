export const TRAILER_MAGIC: number[];
export const KEY_ID_BYTES: 8;
export const SIG_BYTES: 64;
export const TRAILER_BYTES: 76;
export interface Split { image: Uint8Array; keyId: string | null; signature: Uint8Array | null }
export function splitSigned(bytes: Uint8Array): Split;
export function keyIdOf(rawPublicKey: Uint8Array): Promise<string>;
export function importPublicKey(raw32: Uint8Array): Promise<CryptoKey>;
export interface VerifyResult { ok: boolean; image: Uint8Array | null; keyId: string | null; reason: string }
export function verifyImage(bytes: Uint8Array, trustedKeys: Record<string, Uint8Array> | null | undefined): Promise<VerifyResult>;
export function attachSignature(image: Uint8Array, keyIdHex: string, signature: Uint8Array): Uint8Array;
