// Platform geometry queries. The world model is deliberately simple — floating
// AABBs over a void — so everything here is circle-vs-rect in XZ plus vertical
// span logic (adapted from Stargazer-Raiders' collision.ts, extended to 3D), and
// ray tests for hitscan/projectile impacts. Players are vertical capsules
// approximated as: circle of radius r in XZ over the feet->head span.

import type { Box } from './maps/types.ts';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** True if the circle at (x,z,r) overlaps the box footprint in XZ. */
export function footprintOverlap(x: number, z: number, r: number, b: Box): boolean {
  const nx = clamp(x, b.x - b.hw, b.x + b.hw);
  const nz = clamp(z, b.z - b.hd, b.z + b.hd);
  const dx = x - nx;
  const dz = z - nz;
  return dx * dx + dz * dz < r * r;
}

/**
 * Highest platform top the circle could stand on: footprint overlap, and top no
 * higher than `maxTop` (feet + step allowance). -Infinity if over the void.
 */
export function groundHeight(x: number, z: number, r: number, maxTop: number, boxes: readonly Box[]): number {
  let best = -Infinity;
  for (const b of boxes) {
    if (b.top > maxTop || b.top <= best) continue;
    if (footprintOverlap(x, z, r, b)) best = b.top;
  }
  return best;
}

/**
 * Push a circle out of boxes that act as WALLS for a body spanning
 * [feetY, headY]: side faces of platforms whose top is too high to step onto.
 * Mutates pos. Axis pushout makes wall sliding fall out naturally.
 */
export function resolveWalls(
  pos: { x: number; z: number },
  r: number,
  feetY: number,
  headY: number,
  stepMax: number,
  boxes: readonly Box[],
): void {
  for (const b of boxes) {
    if (b.top <= feetY + stepMax) continue; // walkable floor, not a wall
    if (b.bottom >= headY) continue; // fully above us
    const nx = clamp(pos.x, b.x - b.hw, b.x + b.hw);
    const nz = clamp(pos.z, b.z - b.hd, b.z + b.hd);
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;

    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // center inside the box — escape through the shallowest face
      const toLeft = pos.x - (b.x - b.hw);
      const toRight = b.x + b.hw - pos.x;
      const toNear = pos.z - (b.z - b.hd);
      const toFar = b.z + b.hd - pos.z;
      const m = Math.min(toLeft, toRight, toNear, toFar);
      if (m === toLeft) pos.x = b.x - b.hw - r;
      else if (m === toRight) pos.x = b.x + b.hw + r;
      else if (m === toNear) pos.z = b.z - b.hd - r;
      else pos.z = b.z + b.hd + r;
    }
  }
}

/** Lowest platform bottom the head would hit moving up. +Infinity if clear. */
export function ceilingHeight(x: number, z: number, r: number, minBottom: number, boxes: readonly Box[]): number {
  let best = Infinity;
  for (const b of boxes) {
    if (b.bottom < minBottom || b.bottom >= best) continue;
    if (footprintOverlap(x, z, r, b)) best = b.bottom;
  }
  return best;
}

/**
 * Ray vs AABB, slab method. Returns entry t in [0, tMax] or Infinity.
 * Used for sniper occlusion and projectile impact against platforms.
 */
export function rayVsBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tMax: number,
  b: Box,
): number {
  let t0 = 0;
  let t1 = tMax;
  // x slab
  if (Math.abs(dx) < 1e-12) {
    if (ox < b.x - b.hw || ox > b.x + b.hw) return Infinity;
  } else {
    const inv = 1 / dx;
    let ta = (b.x - b.hw - ox) * inv;
    let tb = (b.x + b.hw - ox) * inv;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  // y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < b.bottom || oy > b.top) return Infinity;
  } else {
    const inv = 1 / dy;
    let ta = (b.bottom - oy) * inv;
    let tb = (b.top - oy) * inv;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  // z slab
  if (Math.abs(dz) < 1e-12) {
    if (oz < b.z - b.hd || oz > b.z + b.hd) return Infinity;
  } else {
    const inv = 1 / dz;
    let ta = (b.z - b.hd - oz) * inv;
    let tb = (b.z + b.hd - oz) * inv;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Nearest platform hit along a ray. Returns t or Infinity. */
export function rayVsBoxes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tMax: number,
  boxes: readonly Box[],
): number {
  let best = Infinity;
  for (const b of boxes) {
    const t = rayVsBox(ox, oy, oz, dx, dy, dz, Math.min(tMax, best), b);
    if (t < best) best = t;
  }
  return best;
}

/**
 * Ray vs a player capsule (vertical segment feet+r .. head-r, radius r).
 * Returns the ray parameter t of closest approach if the ray passes within
 * `radius` of the capsule axis before tMax, else Infinity. Closest-approach t is
 * accurate enough at game speeds for both hitscan and per-tick projectile sweeps.
 */
export function rayVsCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tMax: number,
  cx: number, feetY: number, cz: number,
  radius: number, height: number,
): number {
  // capsule axis segment
  const ay = feetY + radius;
  const by = feetY + height - radius;
  // closest points between ray segment (o + t*d, t in [0,tMax]) and axis segment
  // (standard segment-segment: axis direction is (0, by-ay, 0))
  const ex = cx - ox;
  const ey = ay - oy;
  const ez = cz - oz;
  const axisLen = by - ay;
  const dd = dx * dx + dy * dy + dz * dz;
  if (dd < 1e-12) return Infinity;
  const dDotAxis = dy * axisLen;
  const dDotE = dx * ex + dy * ey + dz * ez;
  const axisDotE = axisLen * ey;
  const denom = dd * axisLen * axisLen - dDotAxis * dDotAxis;
  let t: number; // along ray
  let s: number; // along axis 0..1
  if (Math.abs(denom) > 1e-9) {
    t = (dDotE * axisLen * axisLen - axisDotE * dDotAxis) / denom;
  } else {
    t = dDotE / dd; // parallel: project capsule base onto ray
  }
  t = clamp(t, 0, tMax);
  if (axisLen > 1e-9) {
    s = clamp((oy + dy * t - ay) / axisLen, 0, 1);
  } else {
    s = 0;
  }
  // re-project t against the clamped s for a better answer
  const px = cx;
  const py = ay + axisLen * s;
  const pz = cz;
  t = clamp(((px - ox) * dx + (py - oy) * dy + (pz - oz) * dz) / dd, 0, tMax);
  const qx = ox + dx * t - px;
  const qy = oy + dy * t - py;
  const qz = oz + dz * t - pz;
  return qx * qx + qy * qy + qz * qz <= radius * radius ? t : Infinity;
}

/** Is (x,z) over any platform footprint (inflated)? Bot edge probes/recovery. */
export function overAnyPlatform(x: number, z: number, inflate: number, boxes: readonly Box[]): boolean {
  for (const b of boxes) {
    if (Math.abs(x - b.x) <= b.hw + inflate && Math.abs(z - b.z) <= b.hd + inflate) return true;
  }
  return false;
}

/** Highest platform top under (x,z) regardless of height — pickup landing, bots. */
export function topUnder(x: number, z: number, r: number, boxes: readonly Box[]): number {
  return groundHeight(x, z, r, Infinity, boxes);
}
