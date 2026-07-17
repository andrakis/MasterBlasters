// The netcode contract, defined from M1 even though v1 never serializes it.
// Phase 2 (host-authoritative WebRTC snapshots, HL2-style) adds TRANSPORT to these
// shapes, not new shapes: clients send UserCmds upstream at CFG.CMD_HZ, the host
// runs the only sim and sends quantized, delta-compressed Snapshots downstream at
// CFG.SNAPSHOT_HZ over an unreliable-unordered DataChannel, plus ordered Events on
// a reliable channel. Everything the sim consumes as player intent — human input,
// bot output, and eventually remote peers — is a UserCmd.

export const BTN = { JUMP: 1, JET: 2, FIRE: 4 } as const;

// One tick of player intent. moveX/moveZ arrive already rotated into world space
// (camera rotation is a render concern; the sim only sees a desired direction).
// Wire quantization (phase 2): moveX/moveZ i8, yaw u16 (2π/65536), pitch i16,
// buttons u8, weapon u4, seq u16 — ~10 bytes.
export interface UserCmd {
  seq: number;
  buttons: number; // BTN bitfield
  moveX: number; // world-space desired direction, |v| <= 1
  moveZ: number;
  yaw: number; // aim facing — an input, never the camera
  pitch: number;
  weapon: number; // requested slot 0..3, or -1 = keep current
}

export const NEUTRAL_CMD: UserCmd = {
  seq: 0, buttons: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, weapon: -1,
};

// --- snapshot shapes (phase 2 wire; today only a documentation of the split) ----
// The sim keeps replicated state (below — what a snapshot carries) separate from
// host-only state (AI brains, drop-director timers, RNG streams) so the codec can
// serialize PlayerCore/ProjectileCore/PickupCore directly. Quantization plan:
// pos 16-bit per axis against map bounds, vel i8 at 0.5 m/s steps, yaw/pitch u8,
// hp/energy u8, per-entity dirty masks against the last client-acked snapshot.

export interface Snapshot {
  tick: number;
  ackSeq: number; // newest UserCmd.seq folded into this state (prediction replay point)
  players: import('./sim/types').PlayerCore[];
  projectiles: import('./sim/types').ProjectileCore[];
  pickups: import('./sim/types').PickupCore[];
  round: import('./sim/types').RoundCore;
}

// --- reliable-channel events (phase 2) — the same SimEvent list the renderer
// drains locally today (sim/types.ts); listed here to mark them wire-bound.

// ============================================================================
// Binary codec — the actual wire format.
//
// UserCmd: 10 bytes. Snapshot: ~16 B header + 30 B/player + 15 B/projectile +
// 9 B/pickup ≈ 300-500 B typical, sent at 20 Hz => well under 10 KB/s per client.
// Quantization: positions i16 at 1/64 m (±512 m range), velocities i16 at
// 1/256 m/s, angles u16/i16, meters u8. Full state every snapshot — idempotent,
// so packet loss needs no ack bookkeeping (delta encoding is a future
// optimization, not a correctness feature).
// ============================================================================

import { STRIDE, P } from './config.ts';

const TWO_PI = Math.PI * 2;
const POS_Q = 64;
const VEL_Q = 256;

export function encodeCmd(cmd: UserCmd): ArrayBuffer {
  const buf = new ArrayBuffer(10);
  const dv = new DataView(buf);
  dv.setUint16(0, cmd.seq & 0xffff);
  dv.setUint8(2, cmd.buttons & 0xff);
  dv.setInt8(3, Math.round(Math.max(-1, Math.min(1, cmd.moveX)) * 127));
  dv.setInt8(4, Math.round(Math.max(-1, Math.min(1, cmd.moveZ)) * 127));
  const yaw = ((cmd.yaw % TWO_PI) + TWO_PI) % TWO_PI;
  dv.setUint16(5, Math.round((yaw / TWO_PI) * 65535));
  dv.setInt16(7, Math.round(Math.max(-1.6, Math.min(1.6, cmd.pitch)) * 10000));
  dv.setInt8(9, cmd.weapon);
  return buf;
}

export function decodeCmd(buf: ArrayBuffer): UserCmd {
  const dv = new DataView(buf);
  return {
    seq: dv.getUint16(0),
    buttons: dv.getUint8(2),
    moveX: dv.getInt8(3) / 127,
    moveZ: dv.getInt8(4) / 127,
    yaw: (dv.getUint16(5) / 65535) * TWO_PI,
    pitch: dv.getInt16(7) / 10000,
    weapon: dv.getInt8(9),
  };
}

// What the encoder needs from a worker frame (and what the decoder rebuilds):
// the flat entity buffers plus the round scalars. Shapes match simClient.Frame.
export interface SnapState {
  tick: number;
  players: Float32Array;
  nPlayers: number;
  projectiles: Float32Array;
  nProjectiles: number;
  pickups: Float32Array;
  nPickups: number;
  round: {
    phase: 'countdown' | 'active' | 'roundEnd' | 'matchEnd';
    roundNumber: number;
    suddenDeath: boolean;
    countdownS: number;
    timeLeftS: number;
    wins: [number, number][];
  };
}

const PHASES = ['countdown', 'active', 'roundEnd', 'matchEnd'] as const;

export function encodeSnapshot(s: SnapState): ArrayBuffer {
  const size = 13 + s.round.wins.length * 2 + s.nPlayers * 30 + s.nProjectiles * 15 + s.nPickups * 9;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o, 1); o += 1; // msg kind: snapshot
  dv.setUint32(o, s.tick); o += 4;
  dv.setUint8(o, s.nPlayers); o += 1;
  dv.setUint8(o, s.nProjectiles); o += 1;
  dv.setUint8(o, s.nPickups); o += 1;
  const phaseIdx = Math.max(0, PHASES.indexOf(s.round.phase));
  const hasTimer = s.round.timeLeftS >= 0;
  dv.setUint8(o, phaseIdx | (s.round.suddenDeath ? 0x10 : 0) | (hasTimer ? 0x20 : 0)); o += 1;
  dv.setUint8(o, s.round.roundNumber & 0xff); o += 1;
  const phaseS = s.round.phase === 'countdown' ? s.round.countdownS : hasTimer ? s.round.timeLeftS : 0;
  dv.setUint16(o, Math.min(65535, Math.round(phaseS * 10))); o += 2;
  dv.setUint8(o, s.round.wins.length); o += 1;
  for (const [team, wins] of s.round.wins) {
    dv.setUint8(o, team); o += 1;
    dv.setUint8(o, wins); o += 1;
  }

  const q16 = (v: number, scale: number) => Math.max(-32768, Math.min(32767, Math.round(v * scale)));
  const p = s.players;
  for (let i = 0; i < s.nPlayers; i++) {
    const b = i * STRIDE.PLAYER;
    dv.setUint8(o, p[b + P.ID]); o += 1;
    dv.setInt16(o, q16(p[b + P.X], POS_Q)); o += 2;
    dv.setInt16(o, q16(p[b + P.Y], POS_Q)); o += 2;
    dv.setInt16(o, q16(p[b + P.Z], POS_Q)); o += 2;
    dv.setInt16(o, q16(p[b + P.VX], VEL_Q)); o += 2;
    dv.setInt16(o, q16(p[b + P.VY], VEL_Q)); o += 2;
    dv.setInt16(o, q16(p[b + P.VZ], VEL_Q)); o += 2;
    const yaw = ((p[b + P.YAW] % TWO_PI) + TWO_PI) % TWO_PI;
    dv.setUint16(o, Math.round((yaw / TWO_PI) * 65535)); o += 2;
    dv.setInt16(o, Math.round(p[b + P.PITCH] * 10000)); o += 2;
    dv.setUint8(o, Math.round(p[b + P.HP])); o += 1;
    dv.setUint8(o, Math.round(p[b + P.ENERGY])); o += 1;
    dv.setUint8(o, (p[b + P.WEAPON] & 0xf) | ((p[b + P.LIVES] & 0xf) << 4)); o += 1;
    dv.setUint8(
      o,
      (p[b + P.ALIVE] ? 1 : 0) | (p[b + P.GROUNDED] ? 2 : 0) | (p[b + P.JETTING] ? 4 : 0) |
      (p[b + P.BOT] ? 8 : 0) | (p[b + P.NINJA] ? 16 : 0),
    ); o += 1;
    dv.setUint8(o, p[b + P.TEAM]); o += 1;
    dv.setUint8(o, Math.min(255, Math.round(p[b + P.QUAD_T] * 10))); o += 1;
    dv.setUint8(o, Math.min(255, p[b + P.KOS])); o += 1;
    dv.setUint8(o, Math.min(255, p[b + P.FALLS])); o += 1;
    dv.setUint8(o, Math.min(255, Math.max(0, p[b + P.AMMO_SNIPER]))); o += 1;
    dv.setUint8(o, Math.min(255, Math.max(0, p[b + P.AMMO_NUKE]))); o += 1;
    dv.setUint8(o, Math.min(255, Math.round(p[b + P.RESPAWN_S] * 10))); o += 1;
    dv.setUint16(o, p[b + P.CMD_SEQ] & 0xffff); o += 2;
  }

  const pr = s.projectiles;
  for (let i = 0; i < s.nProjectiles; i++) {
    const b = i * STRIDE.PROJECTILE;
    dv.setUint16(o, pr[b] & 0xffff); o += 2; // id
    dv.setUint8(o, (pr[b + 1] & 1) | (pr[b + 8] ? 2 : 0) | ((pr[b + 9] & 0x3f) << 2)); o += 1;
    dv.setInt16(o, q16(pr[b + 2], POS_Q)); o += 2;
    dv.setInt16(o, q16(pr[b + 3], POS_Q)); o += 2;
    dv.setInt16(o, q16(pr[b + 4], POS_Q)); o += 2;
    dv.setInt16(o, q16(pr[b + 5], VEL_Q)); o += 2;
    dv.setInt16(o, q16(pr[b + 6], VEL_Q)); o += 2;
    dv.setInt16(o, q16(pr[b + 7], VEL_Q)); o += 2;
  }

  const pk = s.pickups;
  for (let i = 0; i < s.nPickups; i++) {
    const b = i * STRIDE.PICKUP;
    dv.setUint16(o, pk[b] & 0xffff); o += 2; // id
    dv.setUint8(o, (pk[b + 1] & 0x7f) | (pk[b + 5] ? 0x80 : 0)); o += 1;
    dv.setInt16(o, q16(pk[b + 2], POS_Q)); o += 2;
    dv.setInt16(o, q16(pk[b + 3], POS_Q)); o += 2;
    dv.setInt16(o, q16(pk[b + 4], POS_Q)); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): SnapState {
  const dv = new DataView(buf);
  let o = 1; // skip msg kind
  const tick = dv.getUint32(o); o += 4;
  const nPlayers = dv.getUint8(o); o += 1;
  const nProjectiles = dv.getUint8(o); o += 1;
  const nPickups = dv.getUint8(o); o += 1;
  const phaseByte = dv.getUint8(o); o += 1;
  const roundNumber = dv.getUint8(o); o += 1;
  const phaseS = dv.getUint16(o) / 10; o += 2;
  const nWins = dv.getUint8(o); o += 1;
  const wins: [number, number][] = [];
  for (let i = 0; i < nWins; i++) {
    wins.push([dv.getUint8(o), dv.getUint8(o + 1)]);
    o += 2;
  }
  const phase = PHASES[phaseByte & 0x0f];
  const hasTimer = (phaseByte & 0x20) !== 0;

  const players = new Float32Array(nPlayers * STRIDE.PLAYER);
  for (let i = 0; i < nPlayers; i++) {
    const b = i * STRIDE.PLAYER;
    players[b + P.ID] = dv.getUint8(o); o += 1;
    players[b + P.X] = dv.getInt16(o) / POS_Q; o += 2;
    players[b + P.Y] = dv.getInt16(o) / POS_Q; o += 2;
    players[b + P.Z] = dv.getInt16(o) / POS_Q; o += 2;
    players[b + P.VX] = dv.getInt16(o) / VEL_Q; o += 2;
    players[b + P.VY] = dv.getInt16(o) / VEL_Q; o += 2;
    players[b + P.VZ] = dv.getInt16(o) / VEL_Q; o += 2;
    players[b + P.YAW] = (dv.getUint16(o) / 65535) * TWO_PI; o += 2;
    players[b + P.PITCH] = dv.getInt16(o) / 10000; o += 2;
    players[b + P.HP] = dv.getUint8(o); o += 1;
    players[b + P.ENERGY] = dv.getUint8(o); o += 1;
    const wl = dv.getUint8(o); o += 1;
    players[b + P.WEAPON] = wl & 0xf;
    players[b + P.LIVES] = (wl >> 4) & 0xf;
    const flags = dv.getUint8(o); o += 1;
    players[b + P.ALIVE] = flags & 1 ? 1 : 0;
    players[b + P.GROUNDED] = flags & 2 ? 1 : 0;
    players[b + P.JETTING] = flags & 4 ? 1 : 0;
    players[b + P.BOT] = flags & 8 ? 1 : 0;
    players[b + P.NINJA] = flags & 16 ? 1 : 0;
    players[b + P.TEAM] = dv.getUint8(o); o += 1;
    players[b + P.QUAD_T] = dv.getUint8(o) / 10; o += 1;
    players[b + P.KOS] = dv.getUint8(o); o += 1;
    players[b + P.FALLS] = dv.getUint8(o); o += 1;
    players[b + P.AMMO_SNIPER] = dv.getUint8(o); o += 1;
    players[b + P.AMMO_NUKE] = dv.getUint8(o); o += 1;
    players[b + P.RESPAWN_S] = dv.getUint8(o) / 10; o += 1;
    players[b + P.CMD_SEQ] = dv.getUint16(o); o += 2;
  }

  const projectiles = new Float32Array(nProjectiles * STRIDE.PROJECTILE);
  for (let i = 0; i < nProjectiles; i++) {
    const b = i * STRIDE.PROJECTILE;
    projectiles[b] = dv.getUint16(o); o += 2;
    const kb = dv.getUint8(o); o += 1;
    projectiles[b + 1] = kb & 1;
    projectiles[b + 8] = kb & 2 ? 1 : 0;
    projectiles[b + 9] = (kb >> 2) & 0x3f;
    projectiles[b + 2] = dv.getInt16(o) / POS_Q; o += 2;
    projectiles[b + 3] = dv.getInt16(o) / POS_Q; o += 2;
    projectiles[b + 4] = dv.getInt16(o) / POS_Q; o += 2;
    projectiles[b + 5] = dv.getInt16(o) / VEL_Q; o += 2;
    projectiles[b + 6] = dv.getInt16(o) / VEL_Q; o += 2;
    projectiles[b + 7] = dv.getInt16(o) / VEL_Q; o += 2;
  }

  const pickups = new Float32Array(nPickups * STRIDE.PICKUP);
  for (let i = 0; i < nPickups; i++) {
    const b = i * STRIDE.PICKUP;
    pickups[b] = dv.getUint16(o); o += 2;
    const kb = dv.getUint8(o); o += 1;
    pickups[b + 1] = kb & 0x7f;
    pickups[b + 5] = kb & 0x80 ? 1 : 0;
    pickups[b + 2] = dv.getInt16(o) / POS_Q; o += 2;
    pickups[b + 3] = dv.getInt16(o) / POS_Q; o += 2;
    pickups[b + 4] = dv.getInt16(o) / POS_Q; o += 2;
  }

  return {
    tick, players, nPlayers, projectiles, nProjectiles, pickups, nPickups,
    round: {
      phase,
      roundNumber,
      suddenDeath: (phaseByte & 0x10) !== 0,
      countdownS: phase === 'countdown' ? phaseS : 0,
      timeLeftS: hasTimer ? phaseS : -1,
      wins,
    },
  };
}

// --- reliable-channel messages (JSON; low rate) ----------------------------------

export type OrdMsg =
  | { t: 'hello'; name: string } // peer -> host on channel open
  | { t: 'welcome'; playerId: number; roster: string[] } // host -> peer
  | { t: 'roster'; roster: string[] } // host -> all, lobby updates
  | { t: 'start'; settings: MatchSettings; names: string[]; yourId: number }
  | { t: 'names'; names: string[] } // full in-match names (humans + generated bots)
  | { t: 'events'; tick: number; events: import('./sim/types.ts').SimEvent[] }
  | { t: 'ping'; at: number } // host -> peer, for lag compensation RTT
  | { t: 'pong'; at: number } // peer echo
  | { t: 'bye' };

// --- signaling (WebSocket JSON, relayed by server/signaling.js) -------------------

export type SignalMsg =
  | { t: 'host' }
  | { t: 'hosted'; code: string }
  | { t: 'join'; code: string }
  | { t: 'joined' }
  | { t: 'peer'; peerId: number } // to host: a client joined the room
  | { t: 'signal'; peerId?: number; data: unknown } // SDP/ICE relay (peerId host-side)
  | { t: 'peer-left'; peerId: number }
  | { t: 'host-left' }
  | { t: 'error'; message: string };

// --- match configuration (host -> all on join / menu -> worker locally) ---------
export interface MatchSettings {
  mapId: string;
  mode: 'lms' | 'team' | 'timed';
  lives: number;
  botCount: number;
  botTier: number; // index into AI_TIERS
  seed: number;
  // Multiplayer roster, slot-ordered (slot 0 = host). When absent the world
  // synthesizes the single-player roster: one human + botCount bots.
  roster?: { name: string; bot: boolean }[];
}
