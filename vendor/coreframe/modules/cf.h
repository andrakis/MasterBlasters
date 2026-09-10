// cf.h -- the CoreFrame module API. A module (a game's rules: C in c4lc's C99
// subset, or the TypeScript subset through ts2c) includes this and defines
// cf_init and cf_frame; it answers with cf_emit, which the host side of the
// link provides: cf_main.c on the board, cf_native.c under the native harness,
// cf_kmain.c under C4KE. The same module unit links against any of the three.
#ifndef CF_H
#define CF_H
void cf_init();
void cf_frame(int type, int *payload, int n);
void cf_emit(int type, int *payload, int n);
#endif
