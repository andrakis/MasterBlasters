// cf_mbox.h -- a CoreFrame module's side of the mailbox: the c4bb guest
// helpers (include/c4bb_mbox.h upstream, mirrored here verbatim so a
// project builds without the c4 checkout) plus the resident-process loop.
//
// A module defines `void cf_init()` (called once) and
// `void cf_frame(int type, int *payload, int n)` (called per frame) and
// answers with `cf_emit(type, payload, n)`; the resident loop in cf_main.c
// comes AFTER the module in the source list because c4 is single-pass.
// The host stops the machine at the idle bell and resumes it when it has
// queued more; the module keeps its state in globals, nothing is replayed.
//
// Board only, after the INFO check. Source order for a build:
//   cf_mbox.h  <frames.h>  <module.c>  cf_main.c

enum {
	MB_BASE = 0x1b4, MB_LEN = 0x1b8, MB_BELL = 0x1bc,
	MB_CAP = 0, MB_HEAD = 1, MB_TAIL = 2, MB_DATA = 3, MB_HDR = 3,
	MB_BELL_REPLY = 1, MB_BELL_IDLE = 2,
	C4I_MBOX = 0x2000
};

int *mb_in; int *mb_out; int mb_seq;

int mb_init () {
	int base, len, half;
	if (!(__c4_info() & C4I_MBOX)) return 0;
	base = *(int *)MB_BASE; len = *(int *)MB_LEN;
	if (!base || !len) return 0;
	half = len / 2;
	mb_in = (int *)base; mb_out = (int *)(base + half); mb_seq = 0;
	return 1;
}
int *mb_poll () {
	int cap, head, tail, at;
	cap = mb_in[MB_CAP]; head = mb_in[MB_HEAD]; tail = mb_in[MB_TAIL];
	if (head == tail) return 0;
	at = tail % cap;
	if (mb_in[MB_DATA + at] == -1) {
		tail = tail + (cap - at); mb_in[MB_TAIL] = tail;
		if (head == tail) return 0;
		at = 0;
	}
	return mb_in + MB_DATA + at;
}
void mb_done (int *frame) { mb_in[MB_TAIL] = mb_in[MB_TAIL] + frame[0]; }
int mb_send (int type, int *payload, int n) {
	int cap, head, tail, at, len, free, i, *f;
	cap = mb_out[MB_CAP]; head = mb_out[MB_HEAD]; tail = mb_out[MB_TAIL];
	len = MB_HDR + n; free = cap - (head - tail); at = head % cap;
	if (at + len > cap) {
		if (free < (cap - at) + len) return 0;
		mb_out[MB_DATA + at] = -1; head = head + (cap - at); at = 0;
		free = cap - (head - tail);
	}
	if (free < len) return 0;
	f = mb_out + MB_DATA + at;
	f[1] = type; f[2] = mb_seq; mb_seq = mb_seq + 1;
	i = 0; while (i < n) { f[MB_HDR + i] = payload[i]; i = i + 1; }
	f[0] = len; mb_out[MB_HEAD] = head + len;
	return 1;
}
void mb_bell (int v) { *(int *)MB_BELL = v; }

// A module answers with cf_emit; under the native harness it prints instead.
void cf_emit (int type, int *payload, int n) {
	if (!mb_send(type, payload, n)) printf("cf: outbox full (type %d)\n", type);
}
