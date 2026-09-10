// mb_rules_core.c -- the match rules of Master Blasters, as a CoreFrame
// module: a resident process that receives frames (src/rules/frames.json)
// and answers with verdicts. This is the authority for stream seeding,
// spawn slots, KO credit, lives, round results, sudden death and match
// wins; the game's World adopts what comes back and computes none of it.
//
// Written in c4lc's C99 subset (vendor/coreframe: docs/build.md lists what it
// takes). Every intermediate is a 32-bit int on both hosts (c4bb and native
// c4m32), so the arithmetic below wraps identically.
//
// One unit: it links against cf_main.c (the board) or cf_native.c (the
// parity harness) unchanged.
#include "cf.h"
#include "frames.h"

enum { MAXP = 8, MAXT = 8 };
enum { R_CONTINUE = 0, R_WINNER = 1, R_DRAW = 2 };
enum { NO_LEADER = -3 };

int st_seed, st_mode, st_maxlives, st_rounds, st_kocredit, st_spots, st_n;
int team[8], lives[8], kos[8], falls[8], alive[8], slot[8], wins[8];
int st_round, st_result, st_winner, st_sudden, st_matchover, st_decided, st_timer;
int st_cv, st_ca;
int reply[64];

// src/math.ts deriveSeed, bit for bit: Math.imul is a wrapping 32-bit multiply,
// and >>> N becomes an arithmetic shift masked to the low 32-N bits.
int derive_seed (int run, int idx) {
    int h;
    h = run ^ ((idx + 1) * -1640531527);
    h = (h ^ ((h >> 16) & 65535)) * -2048144789;
    h = (h ^ ((h >> 13) & 524287)) * -1028477387;
    return h ^ ((h >> 16) & 65535);
}

int contention (int i) { return alive[i] || lives[i] > 0; }

// the winning team, -1 for a mutual wipe, NO_LEADER while two teams stand
int elimination () {
    int t, i;
    t = -2; i = 0;
    while (i < st_n) {
        if (contention(i)) {
            if (t == -2) t = team[i];
            else if (team[i] != t) return NO_LEADER;
        }
        i = i + 1;
    }
    if (t == -2) return -1;
    return t;
}

// the unique team with the most lives (a living body counts one), else NO_LEADER
int lives_leader () {
    int tl[8], seen[8], i, best, bl, tied, t;
    i = 0; while (i < MAXT) { tl[i] = 0; seen[i] = 0; i = i + 1; }
    i = 0;
    while (i < st_n) {
        t = team[i];
        if (t >= 0 && t < MAXT) { tl[t] = tl[t] + lives[i] + (alive[i] ? 1 : 0); seen[t] = 1; }
        i = i + 1;
    }
    best = -1; bl = -1; tied = 0; i = 0;
    while (i < MAXT) {
        if (seen[i]) {
            if (tl[i] > bl) { best = i; bl = tl[i]; tied = 0; }
            else if (tl[i] == bl) tied = 1;
        }
        i = i + 1;
    }
    if (tied || best < 0) return NO_LEADER;
    return best;
}

void emit_verdict () {
    int i, k;
    reply[0] = st_round; reply[1] = st_result; reply[2] = st_winner;
    reply[3] = st_sudden; reply[4] = st_matchover; reply[5] = st_cv; reply[6] = st_ca;
    i = 0; while (i < MAXT) { reply[7 + i] = wins[i]; i = i + 1; }
    reply[15] = st_n;
    i = 0; k = 16;
    while (i < st_n) {
        reply[k] = lives[i]; reply[k + 1] = kos[i]; reply[k + 2] = falls[i];
        reply[k + 3] = alive[i]; reply[k + 4] = slot[i];
        k = k + 5; i = i + 1;
    }
    cf_emit(MB_VERDICT, reply, k);
}

// world.ts step 7 (the active branch), evaluated at the end of a tick group
void decide () {
    int w;
    if (st_decided) return;
    w = elimination();
    if (w == NO_LEADER && st_mode == 2) {
        if (st_sudden) w = lives_leader();
        else if (st_timer) {
            w = lives_leader();
            if (w == NO_LEADER) st_sudden = 1;
        }
    }
    if (w == NO_LEADER) return;
    st_decided = 1;
    if (w >= 0) {
        st_result = R_WINNER; st_winner = w;
        wins[w] = wins[w] + 1;
        if (wins[w] >= st_rounds) st_matchover = 1;
    } else {
        st_result = R_DRAW; st_winner = -1;
    }
}

void cf_init () {
    int i;
    st_n = 0; st_round = 0; st_result = R_CONTINUE; st_winner = -1;
    st_cv = -1; st_ca = -1;
    i = 0; while (i < MAXP) { team[i] = 0; lives[i] = 0; kos[i] = 0; falls[i] = 0; alive[i] = 0; slot[i] = 0; wins[i] = 0; i = i + 1; }
}

void on_match_start (int *p, int n) {
    int i, streams[3];
    st_seed = p[MB_MATCH_START_SEED]; st_mode = p[MB_MATCH_START_MODE];
    st_maxlives = p[MB_MATCH_START_LIVES]; st_rounds = p[MB_MATCH_START_ROUNDS];
    st_kocredit = p[MB_MATCH_START_KOCREDIT]; st_spots = p[MB_MATCH_START_SPOTS];
    st_n = p[MB_MATCH_START_NPLAYERS];
    if (st_n > MAXP) st_n = MAXP;
    if (st_spots < 1) st_spots = 1;
    i = 0;
    while (i < st_n) {
        team[i] = (MB_MATCH_START_WORDS + i < n) ? p[MB_MATCH_START_WORDS + i] : i;
        lives[i] = st_maxlives; kos[i] = 0; falls[i] = 0; alive[i] = 1; slot[i] = i % st_spots;
        i = i + 1;
    }
    i = 0; while (i < MAXT) { wins[i] = 0; i = i + 1; }
    st_round = 0; st_result = R_CONTINUE; st_winner = -1; st_sudden = 0; st_matchover = 0;
    st_decided = 0; st_timer = 0; st_cv = -1; st_ca = -1;
    streams[0] = derive_seed(st_seed, 0);
    streams[1] = derive_seed(st_seed, 1);
    streams[2] = derive_seed(st_seed, 2);
    cf_emit(MB_STREAMS, streams, 3);
    emit_verdict();
}

// world.ts startRound: lives reset, everyone alive at their slot; kos/falls persist
void on_round_start (int *p) {
    int i;
    st_round = p[MB_ROUND_START_ROUND];
    i = 0;
    while (i < st_n) { lives[i] = st_maxlives; alive[i] = 1; slot[i] = i % st_spots; i = i + 1; }
    st_result = R_CONTINUE; st_winner = -1; st_sudden = 0; st_decided = 0; st_timer = 0;
    st_cv = -1; st_ca = -1;
    emit_verdict();
}

// world.ts step 5: the void collects
void on_fall (int *p) {
    int tick, v, by, at, credit;
    tick = p[MB_FALL_TICK]; v = p[MB_FALL_VICTIM]; by = p[MB_FALL_LASTHITBY]; at = p[MB_FALL_LASTHITTICK];
    if (v < 0 || v >= st_n) return;
    alive[v] = 0;
    falls[v] = falls[v] + 1;
    if (!st_decided) lives[v] = lives[v] - 1;
    credit = -1;
    if (by >= 0 && by < st_n && tick - at <= st_kocredit && by != v) credit = by;
    if (credit >= 0) kos[credit] = kos[credit] + 1;
    st_cv = v; st_ca = credit;
    emit_verdict();                      // undecided until TICK_END: two falls on one tick both count
}

void on_spawn (int *p) {
    int v;
    v = p[MB_SPAWN_PLAYER];
    if (v >= 0 && v < st_n) alive[v] = 1;
}

void cf_frame (int type, int *p, int n) {
    if (type == MB_MATCH_START) on_match_start(p, n);
    else if (type == MB_ROUND_START) on_round_start(p);
    else if (type == MB_FALL) on_fall(p);
    else if (type == MB_SPAWN) on_spawn(p);
    else if (type == MB_TIMER) { st_timer = 1; decide(); emit_verdict(); }
    else if (type == MB_TICK_END) { decide(); emit_verdict(); }
}
