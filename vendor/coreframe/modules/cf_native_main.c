// cf_native_main.c -- reads the frame log named by argv[1] and drives the
// module. Last in the source list (single-pass compiler).

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
