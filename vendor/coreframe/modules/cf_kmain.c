// cf_kmain.c -- the resident loop UNDER C4KE: bind to the host mailbox through
// the kernel's mailbox extension, await frames in the kernel (no spin), hand
// each to the module, stop on type 0. No u0.h: that runtime is c4cc's (its
// varargs macros never expand under c4lc) and a resident module needs none of
// it -- __c4_opcode is a compiler builtin, and OP_REQUEST_SYMBOL is u0.h:31's
// constant. c4ke_mbox.h names the mailbox opcodes (from the c4 checkout's
// include/, vendored beside this file). Link: <module units> cf_kmain.c
enum { OP_REQUEST_SYMBOL = 128 };
#include "c4ke_mbox.h"
#include "cf.h"

void cf_emit (int type, int *payload, int n) {
	if (!mbox_send(type, payload, n)) printf("cf: outbox full (type %d)\n", type);
}

int main (int argc, char **argv) {
	int buf[80], n;
	if (!mbox_info()) { printf("cf: no host mailbox\n"); return 1; }
	cf_init();
	printf("cf: bound\n");
	while (1) {
		mbox_await(0);
		n = mbox_recv(buf, 80);
		if (n < 3) continue;
		if (buf[1] == 0) break;
		cf_frame(buf[1], buf + 3, n - 3);
	}
	printf("cf: done\n");
	return 0;
}
