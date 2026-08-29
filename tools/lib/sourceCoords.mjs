// Coordinate and angle conversion between Source and our sim.
//
// Kept in one place and unit-tested (test/sourceCoords.test.ts) because getting
// the yaw formula wrong is silent: the map loads, the geometry is right, and
// players simply spawn facing the wrong way.

/** 1 Hammer unit = 1 inch. Verified against the hand-authored arenas' scale. */
export const UNITS_TO_METERS = 0.0254;

/**
 * Source is Z-up / X-forward; three.js and the sim are Y-up. Note this negates
 * Y, which flips handedness — winding order and min/max both need care.
 */
export function sourceToWorld(x, y, z, scale = UNITS_TO_METERS) {
  return [x * scale, z * scale, -y * scale];
}

/**
 * Source `angles` yaw (degrees, CCW about +Z from +X) -> the sim's yaw.
 *
 *   Source facing  = (cos S, sin S)   over Source (x, y)
 *   our facing     = (cos S, -sin S)  over (x, z), since the conversion negates y
 *   sim yaw Y gives (-sin Y, -cos Y)  -- aimDir(), src/sim/combat.ts
 *
 * Solving the pair gives Y = S - 90 degrees.
 *
 * aimDir is the authority here, NOT the hand-authored spawn tables: crusher.ts's
 * z-axis spawns disagree with it and face outward.
 */
export function sourceYawToSimYaw(sourceYawDegrees) {
  const y = (sourceYawDegrees - 90) * Math.PI / 180;
  // normalise to (-PI, PI] so the numbers read like the hand-authored maps
  return Math.atan2(Math.sin(y), Math.cos(y));
}

/**
 * Where the playfield sits, so the collision boxes and the render geometry share
 * one origin. Spawns define where play happens: recentre on their horizontal
 * centroid and put the lowest spawn at y=0, which is the convention every
 * hand-authored map in src/sim/maps follows.
 *
 * BOTH pipelines must apply this, or the textured world drifts off its boxes.
 * Takes Source-space origins ([x, y, z] in Hammer units).
 */
export function playfieldShift(spawnOriginsSource, scale = UNITS_TO_METERS) {
  if (!spawnOriginsSource.length) return [0, 0, 0];
  const world = spawnOriginsSource.map((p) => sourceToWorld(p[0], p[1], p[2], scale));
  return [
    world.reduce((s, p) => s + p[0], 0) / world.length,
    Math.min(...world.map((p) => p[1])),
    world.reduce((s, p) => s + p[2], 0) / world.length,
  ];
}
