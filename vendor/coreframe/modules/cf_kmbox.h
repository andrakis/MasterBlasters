// cf_kmbox.h -- a module's side of the mailbox UNDER C4KE. Source order:
//   <u0.h>  <c4ke_mbox.h>  cf_kmbox.h  <frames.h>  <module.c>  cf_kmain.c
// (u0.h is the C4KE runtime, c4ke_mbox.h the mailbox opcodes by name; both
// from the c4 checkout's include/ or the copies vendored beside this file).
// The same module core runs bare (cf_mbox.h + cf_main.c) or here.

void cf_emit (int type, int *payload, int n) {
	if (!mbox_send(type, payload, n)) printf("cf: outbox full (type %d)\n", type);
}
