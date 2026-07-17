// Sim state, split along the replication seam (protocol.ts): the *Core interfaces
// are what a phase-2 snapshot carries; Host* state (bot brains, director timers,
// RNG) never leaves the host. Keep new fields on the correct side.

import type { UserCmd } from '../protocol.ts';

// --- replicated -----------------------------------------------------------------

export interface PlayerCore {
  id: number;
  team: number; // lms: own id; team mode: 0 = Masters (ninja), 1 = Blasters (cowboy)
  x: number; y: number; z: number; // y = feet
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number; // aim (from the cmd, not the camera)
  hp: number;
  energy: number;
  weapon: number;
  ammo: number[]; // per WPN slot; -1 = infinite
  lives: number;
  alive: boolean;
  respawnAtTick: number; // when dead with lives left
  grounded: boolean;
  jetting: boolean;
  quadUntilTick: number;
  kbLockT: number; // seconds of suppressed ground friction after a hit
  cooldownUntilTick: number;
  kos: number;
  falls: number;
  bot: boolean;
  name: string;
  ninja: boolean; // character flavor: ninja (Masters) vs cowboy (Blasters)
  // input bookkeeping (host-side; cheap enough to live on the core struct)
  prevButtons: number; // for jump edge detection
  lastHitBy: number; // KO credit: -1 or the last attacker...
  lastHitTick: number; // ...within the credit window
  lastCmdSeq: number; // newest UserCmd folded in — the client's prediction replay point
  lagTicks: number; // hitscan lag-compensation rewind for this shooter (host-set)
}

export const PROJ = { ROCKET: 0, NUKE: 1 } as const;

export interface ProjectileCore {
  id: number;
  kind: number; // PROJ.*
  owner: number;
  ownerTeam: number;
  quad: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  bornTick: number;
  dieAtTick: number;
}

export const PICKUP = { HEALTH: 0, ENERGY: 1, SNIPER: 2, NUKE: 3, QUAD: 4 } as const;

export interface PickupCore {
  id: number;
  kind: number; // PICKUP.*
  x: number; y: number; z: number;
  landed: boolean;
  despawnAtTick: number; // set on landing
}

export type RoundPhase = 'countdown' | 'active' | 'roundEnd' | 'matchEnd';

export interface RoundCore {
  phase: RoundPhase;
  phaseEndsTick: number; // countdown/roundEnd transitions; timed mode expiry
  roundNumber: number;
  suddenDeath: boolean; // timed mode tiebreak: next KO wins
  lastWinner: number; // team id of the last round winner (-1 none/draw)
  wins: Map<number, number>; // team id -> round wins
}

// --- host-only --------------------------------------------------------------------

export type BotBehavior = 'fight' | 'collect' | 'edgeGuard' | 'recover';

export interface BotState {
  tier: number;
  behavior: BotBehavior;
  targetId: number; // -1 none
  pickupId: number; // collect target
  decideAtTick: number; // next rethink
  fireOkAtTick: number; // reaction delay after acquiring a target AND between shots
  recoverAtTick: number; // when a knocked-off bot NOTICES it is off the map
  strafeDir: number; // -1 | 1, flipped on a seeded timer
  strafeFlipTick: number;
  jitterYaw: number; // persistent aim error, rerolled each decision
  jitterPitch: number;
  cmd: UserCmd; // reused output buffer
}

// --- events (sim -> renderer/HUD; phase 2 sends these on the reliable channel) ----

export type SimEvent =
  | { t: 'explosion'; x: number; y: number; z: number; r: number; kind: number }
  | { t: 'tracer'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
  | { t: 'saber'; who: number; hit: boolean }
  | { t: 'hit'; victim: number; attacker: number; dmg: number; self: boolean }
  | { t: 'ko'; victim: number; attacker: number } // attacker -1 = plain fall
  | { t: 'pickup'; kind: number; who: number }
  | { t: 'drop'; kind: number; x: number; z: number }
  | { t: 'round'; phase: RoundPhase; winnerTeam: number; winnerName: string }
  | { t: 'fire'; who: number; weapon: number };
