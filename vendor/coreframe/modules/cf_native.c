// cf_native.c -- the native harness's side: runs a module's core under
// native c4m32 (or c4bb without a mailbox) by feeding it a frame log and
// printing every reply, one line per frame: "type: p0 p1 ...". The same
// core, the same bytes, no mailbox -- what test-c4bb's parity is for.
//
// Source order: cf_native.c  <frames.h>  <module.c>  cf_native_main.c
// The log is a file of little-endian i32 words: [type][n][n payload words]...

void cf_emit (int type, int *payload, int n) {
	int i;
	printf("%d:", type);
	i = 0;
	while (i < n) { printf(" %d", payload[i]); i = i + 1; }
	printf("\n");
}
