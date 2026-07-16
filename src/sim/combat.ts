// Damage and knockback resolution. The design's core rule: damage NEVER kills —
// hp clamps at 0 and exists only to scale how far the victim flies (the Smash
// percent, inverted). The only death is the void (world.ts checks killY).

import { TUNING as T } from '../config.ts';
import type { PlayerCore, SimEvent } from './types.ts';

/** The knockback magnitude formula (docs/DESIGN.md): scaled by the damage dealt
 *  and by how hurt the victim already is AFTER the damage is applied. */
export function knockbackMagnitude(dmg: number, victimHp: number, kbMult: number, quadMult: number): number {
  const hurt = 1 - victimHp / T.PLAYER_HP;
  return (T.KB_BASE + dmg * T.KB_DMG) * (1 + T.KB_HP_SCALE * hurt) * kbMult * quadMult;
}

/** Player center (capsule midpoint) — splash range and knockback direction anchor. */
export function centerY(p: { y: number }): number {
  return p.y + T.PLAYER_H / 2;
}

/**
 * Apply a hit: damage first, then the impulse computed from the POST-hit hp.
 * (dirX,dirY,dirZ) need not be normalized; the up-bias floor is applied here.
 * Self-hits (rocket jumps) take reduced damage but the full impulse.
 */
export function applyHit(
  victim: PlayerCore,
  attackerId: number,
  dmg: number,
  dirX: number, dirY: number, dirZ: number,
  kbMult: number,
  quadMult: number,
  events: SimEvent[],
): void {
  const self = victim.id === attackerId;
  const dealt = dmg * (self ? T.SELF_DMG_MULT : 1);
  victim.hp = Math.max(0, victim.hp - dealt);

  let len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-6) { dirX = 0; dirY = 1; dirZ = 0; len = 1; }
  let nx = dirX / len;
  let ny = dirY / len;
  let nz = dirZ / len;
  if (ny < T.KB_UP_BIAS) {
    // re-point above the bias floor, preserving the horizontal bearing
    const h = Math.hypot(nx, nz);
    const hTarget = Math.sqrt(1 - T.KB_UP_BIAS * T.KB_UP_BIAS);
    if (h > 1e-6) {
      nx = (nx / h) * hTarget;
      nz = (nz / h) * hTarget;
    }
    ny = T.KB_UP_BIAS;
  }

  const kb = knockbackMagnitude(dealt, victim.hp, kbMult, quadMult) * (self ? T.SELF_KB_MULT : 1);
  victim.vx += nx * kb;
  victim.vy += ny * kb;
  victim.vz += nz * kb;
  victim.grounded = false; // a launch, not a shove along the floor
  victim.kbLockT = T.KB_FRICTION_LOCK;

  events.push({ t: 'hit', victim: victim.id, attacker: attackerId, dmg: dealt, self });
}

/**
 * Radial splash at (x,y,z): linear damage/knockback falloff to `radius`, pushing
 * every living player away from the blast point. Friendly fire is a mode concern —
 * the caller passes the set of players already filtered.
 */
export function applySplash(
  players: readonly PlayerCore[],
  attackerId: number,
  x: number, y: number, z: number,
  radius: number,
  baseDmg: number,
  kbMult: number,
  quadMult: number,
  events: SimEvent[],
): void {
  for (const p of players) {
    if (!p.alive) continue;
    const dx = p.x - x;
    const dy = centerY(p) - y;
    const dz = p.z - z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= radius) continue;
    const falloff = 1 - dist / radius;
    applyHit(p, attackerId, baseDmg * falloff, dx, dy, dz, kbMult * falloff, quadMult, events);
  }
}

/** Aim direction from yaw/pitch (three.js convention: yaw 0 faces -Z, pitch up +). */
export function aimDir(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
