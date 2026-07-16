// Weapon firing. All four weapons resolve through here: projectiles spawn sim
// entities (projectiles.ts flies them), hitscan and melee resolve immediately.
// The caller (world.ts) has already decided WHO is allowed to be hurt by passing
// friendlyFire; self-hits only ever come from splash, never direct fire.

import { CFG, TUNING as T, WEAPONS, WPN } from '../config.ts';
import { aimDir, applyHit, centerY } from './combat.ts';
import { rayVsBoxes, rayVsCapsule } from './collision.ts';
import type { Box } from './maps/types.ts';
import type { PickupCore, PlayerCore, ProjectileCore, SimEvent } from './types.ts';

export interface FireCtx {
  players: PlayerCore[];
  boxes: readonly Box[];
  projectiles: ProjectileCore[];
  pickups: PickupCore[];
  events: SimEvent[];
  tick: number;
  friendlyFire: boolean;
  nextId: () => number;
}

const SNIPER_RANGE = 200;

export function quadMultOf(p: PlayerCore, tick: number): number {
  return tick < p.quadUntilTick ? T.QUAD_MULT : 1;
}

/** True if `target` may be hurt by `shooter` under the mode's friendly-fire rule. */
function canHurt(shooter: PlayerCore, target: PlayerCore, friendlyFire: boolean): boolean {
  if (!target.alive || target.id === shooter.id) return false;
  return friendlyFire || target.team !== shooter.team;
}

export function tryFire(p: PlayerCore, ctx: FireCtx): void {
  if (!p.alive || ctx.tick < p.cooldownUntilTick) return;
  const spec = WEAPONS[p.weapon];
  const ammo = p.ammo[p.weapon];
  if (ammo === 0) {
    p.weapon = WPN.ROCKET; // dry — fall back to the infinite launcher
    return;
  }

  p.cooldownUntilTick = ctx.tick + Math.round(spec.cooldownS * CFG.TICK_HZ);
  if (ammo > 0) p.ammo[p.weapon] = ammo - 1;
  const quad = quadMultOf(p, ctx.tick);
  const dir = aimDir(p.yaw, p.pitch);
  const eyeY = p.y + T.EYE_HEIGHT;
  ctx.events.push({ t: 'fire', who: p.id, weapon: p.weapon });

  if (spec.kind === 'projectile') {
    // muzzle slightly forward so the rocket doesn't clip the shooter's own capsule
    const m = T.PLAYER_R + 0.25;
    ctx.projectiles.push({
      id: ctx.nextId(),
      kind: p.weapon === WPN.NUKE ? 1 : 0,
      owner: p.id,
      ownerTeam: p.team,
      quad: quad > 1,
      x: p.x + dir.x * m,
      y: eyeY + dir.y * m,
      z: p.z + dir.z * m,
      vx: dir.x * spec.projSpeed,
      vy: dir.y * spec.projSpeed,
      vz: dir.z * spec.projSpeed,
      bornTick: ctx.tick,
      dieAtTick: ctx.tick + Math.round(spec.projLifeS * CFG.TICK_HZ),
    });
  } else if (spec.kind === 'hitscan') {
    const tWall = rayVsBoxes(p.x, eyeY, p.z, dir.x, dir.y, dir.z, SNIPER_RANGE, ctx.boxes);
    let tBest = tWall;
    let hit: PlayerCore | null = null;
    for (const q of ctx.players) {
      if (!canHurt(p, q, ctx.friendlyFire)) continue;
      const t = rayVsCapsule(
        p.x, eyeY, p.z, dir.x, dir.y, dir.z, tBest,
        q.x, q.y, q.z, T.PLAYER_R, T.PLAYER_H,
      );
      if (t < tBest) { tBest = t; hit = q; }
    }
    const tEnd = Math.min(tBest, SNIPER_RANGE);
    ctx.events.push({
      t: 'tracer',
      x0: p.x + dir.x, y0: eyeY + dir.y - 0.15, z0: p.z + dir.z,
      x1: p.x + dir.x * tEnd, y1: eyeY + dir.y * tEnd, z1: p.z + dir.z * tEnd,
    });
    if (hit) applyHit(hit, p.id, spec.dmg, dir.x, dir.y, dir.z, spec.kbMult, quad, ctx.events);
  } else {
    // saber: cone check against each huntable capsule center, knock AWAY from the
    // attacker, and burn the victim's jetpack — the anti-recovery weapon
    let connected = false;
    for (const q of ctx.players) {
      if (!canHurt(p, q, ctx.friendlyFire)) continue;
      const dx = q.x - p.x;
      const dy = centerY(q) - eyeY;
      const dz = q.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > spec.reach + T.PLAYER_R) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(dist, 1e-6);
      if (dot < spec.halfArcCos) continue;
      q.energy = Math.max(0, q.energy - spec.energyDrain);
      applyHit(q, p.id, spec.dmg, dx, dy, dz, spec.kbMult, quad, ctx.events);
      connected = true;
    }
    ctx.events.push({ t: 'saber', who: p.id, hit: connected });
  }

  if (p.ammo[p.weapon] === 0) p.weapon = WPN.ROCKET;
}
