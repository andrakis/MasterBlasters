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

// --- match configuration (host -> all on join / menu -> worker locally) ---------
export interface MatchSettings {
  mapId: string;
  mode: 'lms' | 'team' | 'timed';
  lives: number;
  botCount: number;
  botTier: number; // index into AI_TIERS
  seed: number;
}
