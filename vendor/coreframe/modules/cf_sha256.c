// cf_sha256.c -- see cf_sha256.h.
#include "cf_sha256.h"

int __cf_k[64];
int __cf_w[64];
int __cf_h[8];
char __cf_tail[128];
char __cf_hex[72];

// rotr(x, n) in the c4 dialect (no unsigned): ((x >> n) & ((1 << (32 - n)) - 1)) | (x << (32 - n));
// the two loops below spell it out with the masks precomputed (a call is ~20 cycles, there are 96 per block)

void cf_sha_k () {
	int *k;
	k = __cf_k;
	k[0]  = 0x428a2f98; k[1]  = 0x71374491; k[2]  = 0xb5c0fbcf; k[3]  = 0xe9b5dba5; k[4]  = 0x3956c25b; k[5]  = 0x59f111f1; k[6]  = 0x923f82a4; k[7]  = 0xab1c5ed5;
	k[8]  = 0xd807aa98; k[9]  = 0x12835b01; k[10] = 0x243185be; k[11] = 0x550c7dc3; k[12] = 0x72be5d74; k[13] = 0x80deb1fe; k[14] = 0x9bdc06a7; k[15] = 0xc19bf174;
	k[16] = 0xe49b69c1; k[17] = 0xefbe4786; k[18] = 0x0fc19dc6; k[19] = 0x240ca1cc; k[20] = 0x2de92c6f; k[21] = 0x4a7484aa; k[22] = 0x5cb0a9dc; k[23] = 0x76f988da;
	k[24] = 0x983e5152; k[25] = 0xa831c66d; k[26] = 0xb00327c8; k[27] = 0xbf597fc7; k[28] = 0xc6e00bf3; k[29] = 0xd5a79147; k[30] = 0x06ca6351; k[31] = 0x14292967;
	k[32] = 0x27b70a85; k[33] = 0x2e1b2138; k[34] = 0x4d2c6dfc; k[35] = 0x53380d13; k[36] = 0x650a7354; k[37] = 0x766a0abb; k[38] = 0x81c2c92e; k[39] = 0x92722c85;
	k[40] = 0xa2bfe8a1; k[41] = 0xa81a664b; k[42] = 0xc24b8b70; k[43] = 0xc76c51a3; k[44] = 0xd192e819; k[45] = 0xd6990624; k[46] = 0xf40e3585; k[47] = 0x106aa070;
	k[48] = 0x19a4c116; k[49] = 0x1e376c08; k[50] = 0x2748774c; k[51] = 0x34b0bcb5; k[52] = 0x391c0cb3; k[53] = 0x4ed8aa4a; k[54] = 0x5b9cca4f; k[55] = 0x682e6ff3;
	k[56] = 0x748f82ee; k[57] = 0x78a5636f; k[58] = 0x84c87814; k[59] = 0x8cc70208; k[60] = 0x90befffa; k[61] = 0xa4506ceb; k[62] = 0xbef9a3f7; k[63] = 0xc67178f2;
}

void cf_sha_block (char *p) {
	int i, a, b, c, d, e, f, g, h, t1, t2, s0, s1, ch, maj, x, y, *w, *k, *st;
	w = __cf_w; k = __cf_k; st = __cf_h;
	i = 0;
	while (i < 16) {
		w[i] = ((p[0] & 255) << 24) | ((p[1] & 255) << 16) | ((p[2] & 255) << 8) | (p[3] & 255);
		p = p + 4;
		i++;
	}
	while (i < 64) {
		x = w[i - 15]; y = w[i - 2];
		s0 = (((x >> 7) & 0x01ffffff) | (x << 25)) ^ (((x >> 18) & 0x00003fff) | (x << 14)) ^ ((x >> 3) & 0x1fffffff);
		s1 = (((y >> 17) & 0x00007fff) | (y << 15)) ^ (((y >> 19) & 0x00001fff) | (y << 13)) ^ ((y >> 10) & 0x003fffff);
		w[i] = w[i - 16] + s0 + w[i - 7] + s1;
		i++;
	}
	a = st[0]; b = st[1]; c = st[2]; d = st[3]; e = st[4]; f = st[5]; g = st[6]; h = st[7];
	i = 0;
	while (i < 64) {
		s1 = (((e >> 6) & 0x03ffffff) | (e << 26)) ^ (((e >> 11) & 0x001fffff) | (e << 21)) ^ (((e >> 25) & 0x0000007f) | (e << 7));
		ch = (e & f) ^ (~e & g);
		t1 = h + s1 + ch + k[i] + w[i];
		s0 = (((a >> 2) & 0x3fffffff) | (a << 30)) ^ (((a >> 13) & 0x0007ffff) | (a << 19)) ^ (((a >> 22) & 0x000003ff) | (a << 10));
		maj = (a & b) ^ (a & c) ^ (b & c);
		t2 = s0 + maj;
		h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
		i++;
	}
	st[0] = st[0] + a; st[1] = st[1] + b; st[2] = st[2] + c; st[3] = st[3] + d;
	st[4] = st[4] + e; st[5] = st[5] + f; st[6] = st[6] + g; st[7] = st[7] + h;
}

// SHA-256 of n bytes at p, as 64 lowercase hex characters (NUL-terminated) in __cf_hex
char *cf_sha256_hex (char *p, int n) {
	int i, rem, tlen, bits, v, *st;
	char *tail, *digits;
	st = __cf_h;
	cf_sha_k();
	st[0] = 0x6a09e667; st[1] = 0xbb67ae85; st[2] = 0x3c6ef372; st[3] = 0xa54ff53a;
	st[4] = 0x510e527f; st[5] = 0x9b05688c; st[6] = 0x1f83d9ab; st[7] = 0x5be0cd19;
	i = 0;
	while (i + 64 <= n) { cf_sha_block(p + i); i = i + 64; }
	rem = n - i;
	tail = __cf_tail;
	memset(tail, 0, 128);
	memcpy(tail, p + i, rem);
	tail[rem] = 0x80;
	tlen = rem < 56 ? 64 : 128;
	bits = n << 3;
	tail[tlen - 1] = bits & 255; tail[tlen - 2] = (bits >> 8) & 255;
	tail[tlen - 3] = (bits >> 16) & 255; tail[tlen - 4] = (bits >> 24) & 255;
	cf_sha_block(tail);
	if (tlen == 128) cf_sha_block(tail + 64);
	digits = "0123456789abcdef";
	i = 0;
	while (i < 8) {
		v = st[i];
		__cf_hex[i * 8 + 0] = digits[(v >> 28) & 15]; __cf_hex[i * 8 + 1] = digits[(v >> 24) & 15];
		__cf_hex[i * 8 + 2] = digits[(v >> 20) & 15]; __cf_hex[i * 8 + 3] = digits[(v >> 16) & 15];
		__cf_hex[i * 8 + 4] = digits[(v >> 12) & 15]; __cf_hex[i * 8 + 5] = digits[(v >> 8) & 15];
		__cf_hex[i * 8 + 6] = digits[(v >> 4) & 15];  __cf_hex[i * 8 + 7] = digits[v & 15];
		i++;
	}
	__cf_hex[64] = 0;
	return __cf_hex;
}

