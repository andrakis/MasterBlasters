// cf_kmain.c -- the resident loop under C4KE: bind to the host mailbox, await
// frames in the kernel (no spin), hand each to the module, stop on type 0.

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
