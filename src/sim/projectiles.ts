// Rocket and mini-nuke flight. Per-tick swept tests (ray along this tick's motion)
// against platforms and capsules so nothing tunnels at 60 Hz. Contact or fuse
// expiry -> explosion -> radial splash. The owner is immune to DIRECT contact for
// a quarter second (the rocket spawns inside their reach) but never to splash —
// rocket jumping is load-bearing mobility.

import { CFG, TUNING as T, WEAPONS } from '../config.ts';
import { applySplash } from './combat.ts';
import { rayVsBox, rayVsCapsule } from './collision.ts';
import type { Box } from './maps/types.ts';
import type { PlayerCore, ProjectileCore, SimEvent } from './types.ts';

const OWNER_GRACE_TICKS = Math.round(0.25 * CFG.TICK_HZ);
const SPEC = [WEAPONS[0], WEAPONS[3]]; // PROJ.ROCKET, PROJ.NUKE -> weapon spec

export function stepProjectiles(
  projectiles: ProjectileCore[],
  players: PlayerCore[],
  boxes: readonly Box[],
  tick: number,
  dt: number,
  gravityMult: number,
  friendlyFire: boolean,
  killY: number,
  events: SimEvent[],
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    const spec = SPEC[pr.kind];
    pr.vy -= T.GRAVITY * gravityMult * spec.projGravityMult * dt;

    const stepLen = Math.hypot(pr.vx, pr.vy, pr.vz) * dt;
    let tHit = Infinity; // in ray-parameter units along the velocity direction
    if (stepLen > 1e-9) {
      const inv = 1 / stepLen;
      const dx = pr.vx * dt * inv;
      const dy = pr.vy * dt * inv;
      const dz = pr.vz * dt * inv;
      for (const b of boxes) {
        const t = rayVsBox(pr.x, pr.y, pr.z, dx, dy, dz, Math.min(stepLen, tHit), b);
        if (t < tHit) tHit = t;
      }
      const graceOver = tick - pr.bornTick > OWNER_GRACE_TICKS;
      for (const q of players) {
        if (!q.alive) continue;
        if (q.id === pr.owner && !graceOver) continue;
        if (!friendlyFire && q.team === pr.ownerTeam && q.id !== pr.owner) continue;
        const t = rayVsCapsule(
          pr.x, pr.y, pr.z, dx, dy, dz, Math.min(stepLen, tHit),
          q.x, q.y, q.z, T.PLAYER_R + 0.2, T.PLAYER_H, // slightly fat: direct hits should feel generous
        );
        if (t < tHit) tHit = t;
      }
      if (tHit < Infinity) {
        pr.x += dx * tHit;
        pr.y += dy * tHit;
        pr.z += dz * tHit;
      } else {
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.z += pr.vz * dt;
      }
    }

    const expired = tick >= pr.dieAtTick;
    if (tHit < Infinity || expired) {
      explode(pr, players, friendlyFire, tick, events);
      projectiles[i] = projectiles[projectiles.length - 1];
      projectiles.pop();
    } else if (pr.y < killY) {
      projectiles[i] = projectiles[projectiles.length - 1];
      projectiles.pop();
    }
  }
}

function explode(
  pr: ProjectileCore,
  players: PlayerCore[],
  friendlyFire: boolean,
  tick: number,
  events: SimEvent[],
): void {
  const spec = SPEC[pr.kind];
  const quadMult = pr.quad ? T.QUAD_MULT : 1;
  // Friendly-fire filter, except the owner always splashes themselves (rocket jumps).
  const targets = players.filter(
    (q) => q.alive && (friendlyFire || q.team !== pr.ownerTeam || q.id === pr.owner),
  );
  applySplash(targets, pr.owner, pr.x, pr.y, pr.z, spec.splashR, spec.dmg, spec.kbMult, quadMult, events);
  events.push({ t: 'explosion', x: pr.x, y: pr.y, z: pr.z, r: spec.splashR, kind: pr.kind });
  void tick;
}
