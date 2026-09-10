// cf_mbox.c -- see cf_mbox.h. Plain loads and stores on the shared rings.
#include "cf_mbox.h"


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
