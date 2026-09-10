// cf_sha256.h -- SHA-256 inside the VM, for attestation (docs/protection.md).
// The same function as runtime/sha256.js, in c4lc's C (no unsigned: logical
// shifts are masked, bytes are masked from signed loads).
#ifndef CF_SHA256_H
#define CF_SHA256_H
// the digest of n bytes at p as 64 lowercase hex characters (NUL-terminated, a static buffer)
char *cf_sha256_hex(char *p, int n);
#endif
