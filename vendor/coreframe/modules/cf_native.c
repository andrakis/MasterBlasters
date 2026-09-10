// cf_native.c -- the native harness: runs a module under native c4m32 (or c4bb
// without a mailbox) by feeding it a frame log and printing every reply, one
// line per frame: "type: p0 p1 ...". The same module unit, the same bytes, no
// mailbox -- what tools/native-parity.mjs compares against the board's replies.
// The log is a file of little-endian i32 words: [type][n][n payload words]...
// Link order: <module units> cf_native.c
#include "cf.h"

void cf_emit (int type, int *payload, int n) {
	int i;
	printf("%d:", type);
	i = 0;
	while (i < n) { printf(" %d", payload[i]); i = i + 1; }
	printf("\n");
}

int main (int argc, char **argv) {
	int fd, *buf, got, at, type, n;
	if (argc < 2) { printf("usage: module <frames.bin>\n"); return 2; }
	buf = (int *)malloc(1 << 20);
	fd = open(argv[1], 0);
	if (fd < 0) { printf("cannot open %s\n", argv[1]); return 2; }
	got = read(fd, (char *)buf, 1 << 20);
	close(fd);
	if (got < 0) { printf("read failed\n"); return 2; }
	got = got / 4;
	cf_init();
	at = 0;
	while (at + 2 <= got) {
		type = buf[at]; n = buf[at + 1];
		if (at + 2 + n > got) break;
		if (type == 0) break;
		cf_frame(type, buf + at + 2, n);
		at = at + 2 + n;
	}
	return 0;
}
