// cf_main.c -- the resident loop. Last in the source list: it calls the
// module's cf_init/cf_frame, and c4 must have seen them already.

int main (int argc, char **argv) {
	int *f;
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
