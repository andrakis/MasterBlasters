/** synchronous SHA-256 (the guest computes the same in modules/cf_main.c) */
export function sha256(bytes: Uint8Array): Uint8Array;
/** lowercase hex of a byte array */
export function hex(bytes: Uint8Array): string;
export const SHA256_K: Int32Array;
