// The player-body integrator — the ONE shared module the netcode plan depends on:
// the worker calls it as the authority, and the main-thread prediction shim
// (PlayerRig.tsx) calls the SAME function so first-person movement has zero worker
// latency today and becomes client-side prediction verbatim in phase 2. Never fork
// this logic.
//
// The body is a vertical capsule (circle r in XZ, feet at y, head at y+H) over
// floating platform AABBs. Air control is Quake-style accelerate (capped along the
// wish direction) so knockback impulses are NOT damped by simply holding a key —
// surviving a hit is jetpack work, not friction.

import { TUNING as T } from '../config.ts';
import { groundHeight, ceilingHeight, resolveWalls } from './collision.ts';
import type { Box } from './maps/types.ts';

export interface BodyState {
  x: number; y: number; z: number; // y = feet
  vx: number; vy: number; vz: number;
  grounded: boolean;
  jetting: boolean;
  energy: number;
  kbLockT: number; // seconds of suppressed ground grip after taking knockback
}

export interface MoveInput {
  moveX: number; // world-space wish direction, |v| <= 1
  moveZ: number;
  jumpEdge: boolean;
  jetHeld: boolean;
}

const wallPos = { x: 0, z: 0 }; // scratch, keeps the hot path allocation-free

export function integrateBody(
  b: BodyState,
  input: MoveInput,
  dt: number,
  boxes: readonly Box[],
  gravityMult = 1,
): void {
  // --- horizontal ------------------------------------------------------------
  if (b.grounded) {
    // exponential approach to the wish velocity; knocked players keep sliding
    const grip = b.kbLockT > 0 ? T.KB_LOCK_ACCEL_MULT : 1;
    const t = Math.min(1, T.ACCEL * grip * dt);
    b.vx += (input.moveX * T.RUN_SPEED - b.vx) * t;
    b.vz += (input.moveZ * T.RUN_SPEED - b.vz) * t;
  } else {
    // Quake air accelerate: add speed along the wish dir only up to RUN_SPEED,
    // never damping momentum you already have (knockback, rocket jumps)
    const wish = Math.hypot(input.moveX, input.moveZ);
    if (wish > 1e-3) {
      const wx = input.moveX / wish;
      const wz = input.moveZ / wish;
      const cur = b.vx * wx + b.vz * wz;
      const add = Math.min(T.AIR_ACCEL * T.RUN_SPEED * dt, Math.max(0, T.RUN_SPEED - cur));
      b.vx += wx * add;
      b.vz += wz * add;
    }
  }
  if (b.kbLockT > 0) b.kbLockT = Math.max(0, b.kbLockT - dt);

  // --- jump & jetpack ----------------------------------------------------------
  if (input.jumpEdge && b.grounded) {
    b.vy = T.JUMP_VY;
    b.grounded = false;
  }
  const canStart = b.jetting || b.energy >= T.JET_MIN_START;
  if (input.jetHeld && b.energy > 0 && canStart) {
    b.jetting = true;
    b.vy += T.JET_ACCEL * dt;
    b.energy = Math.max(0, b.energy - T.JET_DRAIN * dt);
    if (b.energy === 0) b.jetting = false; // flamed out; must rebuild MIN_START
    b.grounded = false;
  } else {
    b.jetting = false;
    const rate = T.JET_RECHARGE * (b.grounded ? 1 : T.JET_AIR_RECHARGE_MULT);
    b.energy = Math.min(T.JET_ENERGY_MAX, b.energy + rate * dt);
  }

  // --- gravity -----------------------------------------------------------------
  if (!b.grounded || b.vy > 0) {
    b.vy -= T.GRAVITY * gravityMult * dt;
    if (b.vy < -T.MAX_FALL) b.vy = -T.MAX_FALL;
  }

  // --- integrate XZ + wall pushout ----------------------------------------------
  wallPos.x = b.x + b.vx * dt;
  wallPos.z = b.z + b.vz * dt;
  resolveWalls(wallPos, T.PLAYER_R, b.y, b.y + T.PLAYER_H, T.STEP_MAX, boxes);
  b.x = wallPos.x;
  b.z = wallPos.z;

  // --- integrate Y: land, fall, or bump ------------------------------------------
  let newY = b.y + b.vy * dt;
  if (b.vy <= 0) {
    const g = groundHeight(b.x, b.z, T.PLAYER_R, b.y + T.STEP_MAX, boxes);
    if (g > -Infinity && newY <= g) {
      newY = g;
      b.vy = 0;
      b.grounded = true;
    } else {
      b.grounded = false;
    }
  } else {
    const c = ceilingHeight(b.x, b.z, T.PLAYER_R, b.y + T.PLAYER_H, boxes);
    if (newY + T.PLAYER_H > c) {
      newY = c - T.PLAYER_H;
      b.vy = 0;
    }
    b.grounded = false;
  }
  b.y = newY;
}
