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

// The doorbell, written straight to the device (protected mode gates opcodes, not
// addresses, so a user task may ring it). The bare loop rings MB_BELL_IDLE to say
// "nothing of yours is left"; under a kernel that value is the KERNEL's to ring when
// no task at all is runnable, so a module says the same thing with its own value:
// MB_BELL_DONE means "I have drained your inbox and answered", and the host may stop
// the machine even though `top` or `mandel` is still runnable.
enum { MB_BELL = 0x1bc, MB_BELL_DONE = 3 };

void cf_emit (int type, int *payload, int n) {
	if (!mbox_send(type, payload, n)) printf("cf: outbox full (type %d)\n", type);
}

int main (int argc, char **argv) {
	int buf[80], n;
	if (!mbox_info()) { printf("cf: no host mailbox\n"); return 1; }
	cf_init();
	printf("cf: bound\n");
	while (1) {
		*(int *)MB_BELL = MB_BELL_DONE;      // done with everything the host queued
		mbox_await(0);
		n = mbox_recv(buf, 80);
		if (n < 3) continue;
		if (buf[1] == 0) break;
		cf_frame(buf[1], buf + 3, n - 3);
	}
	printf("cf: done\n");
	return 0;
}
