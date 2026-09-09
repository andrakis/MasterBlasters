// The rules seam. Everything here used to be computed by world.ts and
// modes.ts in TypeScript; now the CoreFrame VM computes it (src/rules/
// mb_rules_core.c, a resident guest process) and the World ADOPTS what comes
// back. The JS implementations are gone from the shipped bundle on purpose —
// a copied bundle cannot score a round without the VM image.
//
// Calls are synchronous and event-rate: match start, round start, each fall,
// each respawn, the timer, and the end of any tick that had a fall or spawn.
// The full frame log is kept for tools/verify-round.mjs, which replays it on
// the node host and compares the replies.

import { FRAME, readVERDICT, readSTREAMS, packMATCH_START, packROUND_START, packFALL, packSPAWN, packTIMER, packTICK_END } from './frames.ts';

export const MODE_IDS = ['lms', 'team', 'timed'] as const;

export interface MatchHeader {
  seed: number;
  mode: number;          // index into MODE_IDS
  lives: number;
  roundsToWin: number;
  koCreditTicks: number;
  spots: number;         // map.spawnPoints.length
  teams: number[];       // team per player slot
}

export interface PlayerVerdict { lives: number; kos: number; falls: number; alive: boolean; slot: number }

export interface Verdict {
  round: number;
  result: 'continue' | 'winner' | 'draw';
  winnerTeam: number;    // -1 unless 'winner'
  suddenDeath: boolean;
  matchOver: boolean;
  credit: { victim: number; attacker: number } | null;   // the last fall's KO credit (attacker -1 = plain fall)
  wins: number[];        // per team id 0..7
  players: PlayerVerdict[];
}

export interface Rules {
  matchStart(h: MatchHeader): { streams: [number, number, number]; verdict: Verdict };
  roundStart(round: number): Verdict;
  fall(tick: number, victim: number, lastHitBy: number, lastHitTick: number): Verdict;
  spawn(tick: number, player: number): void;
  timer(tick: number): Verdict;
  tickEnd(tick: number): Verdict;
  /** every frame sent so far, in order (for verify-round) */
  log(): LoggedFrame[];
  /** every reply received so far, in order */
  replies(): LoggedFrame[];
}

export interface LoggedFrame { type: number; payload: number[] }

export function parseVerdict(p: Int32Array): Verdict {
  const v = readVERDICT(p);
  const players: PlayerVerdict[] = [];
  for (let i = 0; i < v.nplayers; i++) {
    const k = i * 5;
    players.push({ lives: v.players[k], kos: v.players[k + 1], falls: v.players[k + 2], alive: v.players[k + 3] !== 0, slot: v.players[k + 4] });
  }
  return {
    round: v.round,
    result: v.result === 1 ? 'winner' : v.result === 2 ? 'draw' : 'continue',
    winnerTeam: v.result === 1 ? v.winner : -1,
    suddenDeath: v.sudden !== 0,
    matchOver: v.matchover !== 0,
    credit: v.creditVictim >= 0 ? { victim: v.creditVictim, attacker: v.creditAttacker } : null,
    wins: [v.wins0, v.wins1, v.wins2, v.wins3, v.wins4, v.wins5, v.wins6, v.wins7],
    players,
  };
}

/** A frame exchange: the transport a Rules implementation is built on. */
export interface FrameExchange {
  exchange(type: number, payload: Int32Array): { type: number; payload: Int32Array }[];
}

/** Rules over any frame exchange (the CoreFrame host in the worker and in node). */
export class FrameRules implements Rules {
  private sent: LoggedFrame[] = [];
  private got: LoggedFrame[] = [];
  private x: FrameExchange;
  constructor(x: FrameExchange) { this.x = x; }

  private call(type: number, payload: Int32Array) {
    this.sent.push({ type, payload: Array.from(payload) });
    const replies = this.x.exchange(type, payload);
    for (const r of replies) this.got.push({ type: r.type, payload: Array.from(r.payload) });
    return replies;
  }
  private verdictOf(replies: { type: number; payload: Int32Array }[], what: string): Verdict {
    const v = replies.find((r) => r.type === FRAME.VERDICT);
    if (!v) throw new Error(`rules: no VERDICT after ${what}`);
    return parseVerdict(v.payload);
  }

  matchStart(h: MatchHeader) {
    const replies = this.call(FRAME.MATCH_START, packMATCH_START(h.seed, h.mode, h.lives, h.roundsToWin, h.koCreditTicks, h.spots, h.teams.length, h.teams));
    const s = replies.find((r) => r.type === FRAME.STREAMS);
    if (!s) throw new Error('rules: no STREAMS after MATCH_START');
    const st = readSTREAMS(s.payload);
    return { streams: [st.s0, st.s1, st.s2] as [number, number, number], verdict: this.verdictOf(replies, 'MATCH_START') };
  }
  roundStart(round: number) { return this.verdictOf(this.call(FRAME.ROUND_START, packROUND_START(round)), 'ROUND_START'); }
  fall(tick: number, victim: number, lastHitBy: number, lastHitTick: number) {
    return this.verdictOf(this.call(FRAME.FALL, packFALL(tick, victim, lastHitBy, lastHitTick)), 'FALL');
  }
  spawn(tick: number, player: number) { this.call(FRAME.SPAWN, packSPAWN(tick, player)); }
  timer(tick: number) { return this.verdictOf(this.call(FRAME.TIMER, packTIMER(tick)), 'TIMER'); }
  tickEnd(tick: number) { return this.verdictOf(this.call(FRAME.TICK_END, packTICK_END(tick)), 'TICK_END'); }
  log() { return this.sent; }
  replies() { return this.got; }
}
