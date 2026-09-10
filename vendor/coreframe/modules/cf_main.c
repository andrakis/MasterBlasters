// cf_main.c -- the resident loop on the board: bind the mailbox, hand every
// frame to the module, ring the bells. The module (the game's rules) is another
// unit that includes cf.h and defines cf_init and cf_frame; this unit provides
// cf_emit and main. Link order: <module units> cf_mbox.c cf_sha256.c cf_main.c.
//
// Attestation (docs/protection.md): a host that parked the module's own image
// bytes in guest RAM boots it with
//     argv = module.c4r attest <addr> <len> <sha256 hex>
// and main recomputes SHA-256 over those bytes before anything else. A
// mismatch is a refusal (status 3), and the host makes that loud.
#include "cf.h"
#include "cf_mbox.h"
#include "cf_sha256.h"

// a module answers with cf_emit; on the board that is the outbox ring
void cf_emit (int type, int *payload, int n) {
	if (!mb_send(type, payload, n)) printf("cf: outbox full (type %d)\n", type);
}

int cf_streq (char *a, char *b) {
	while (*a && *a == *b) { a++; b++; }
	return *a == *b;
}

int cf_atoi (char *s) {
	int v;
	v = 0;
	while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
	return v;
}

int main (int argc, char **argv) {
	int *f;
	char *hex;
	if (argc >= 5 && cf_streq(argv[1], "attest")) {
		hex = cf_sha256_hex((char *)cf_atoi(argv[2]), cf_atoi(argv[3]));
		if (!cf_streq(hex, argv[4])) { printf("cf: image hash mismatch: %s\n", hex); return 3; }
		printf("cf: image attested %s\n", hex);
	}
	if (!mb_init()) { printf("cf: mailbox not fitted\n"); return 1; }
	cf_init();
	while (1) {
		f = mb_poll();
		if (!f) { mb_bell(MB_BELL_IDLE); continue; }
		if (f[1] == 0) { mb_done(f); break; }     // frame type 0 = shut down
		cf_frame(f[1], f + MB_HDR, f[0] - MB_HDR);
		mb_done(f);
		mb_bell(MB_BELL_REPLY);
	}
	return 0;
}
