// echo.c -- the smallest module: every frame comes back with its type | 256
// and each payload word + 1. The runtime's own tests and the throughput
// figure use it. Link: echo.c + cf_mbox.c cf_sha256.c cf_main.c (board), or
// echo.c + cf_native.c (native), or echo.c + cf_kmain.c (C4KE).
#include "cf.h"

int echo_buf[64];

void cf_init () { }

void cf_frame (int type, int *p, int n) {
    int i;
    if (n > 64) n = 64;
    i = 0;
    while (i < n) { echo_buf[i] = p[i] + 1; i = i + 1; }
    cf_emit(type | 256, echo_buf, n);
}
