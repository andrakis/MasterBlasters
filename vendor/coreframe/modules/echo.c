// echo.c -- the smallest module: every frame comes back with its type | 256
// and each payload word + 1. The runtime's own tests and the throughput
// figure use it. Build: cf_mbox.h echo.c cf_main.c (or cf_native.c echo.c cf_native_main.c).

int echo_buf[64];

void cf_init () { }

void cf_frame (int type, int *p, int n) {
    int i;
    if (n > 64) n = 64;
    i = 0;
    while (i < n) { echo_buf[i] = p[i] + 1; i = i + 1; }
    cf_emit(type | 256, echo_buf, n);
}
