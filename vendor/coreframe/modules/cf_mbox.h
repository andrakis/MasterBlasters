// cf_mbox.h -- a module's side of the mailbox on the c4bb board: the guest
// helpers over the two rings the host shares with it (include/c4bb_mbox.h
// upstream, mirrored in cf_mbox.c so a project builds without the c4 checkout).
// Board only, after the INFO check: mb_init() returns 0 when the mailbox is
// not fitted (native c4m has no such device) and the caller must stop there.
#ifndef CF_MBOX_H
#define CF_MBOX_H
enum {
	MB_BASE = 0x1b4, MB_LEN = 0x1b8, MB_BELL = 0x1bc,
	MB_CAP = 0, MB_HEAD = 1, MB_TAIL = 2, MB_DATA = 3, MB_HDR = 3,
	MB_BELL_REPLY = 1, MB_BELL_IDLE = 2,
	C4I_MBOX = 0x2000
};
int mb_init();                              // 1 when the mailbox is fitted and located
int *mb_poll();                             // the next inbound frame ([len][type][seq][payload...]) or 0
void mb_done(int *frame);                   // release a polled frame
int mb_send(int type, int *payload, int n); // queue a reply; 0 when the outbox is full
void mb_bell(int v);                        // MB_BELL_REPLY / MB_BELL_IDLE to the host
#endif
