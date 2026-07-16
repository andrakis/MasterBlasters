// The tuning arena: a symmetric cross used to gate the M2 knockback/jetpack feel
// before any real map exists. Center pad, four satellites across jetpack-sized
// gaps, one raised top pad for sniper sightlines.

import type { MapDef } from './types.ts';

export const testArena: MapDef = {
  id: 'mb_test',
  name: 'Test Arena',
  platforms: [
    { x: 0, y: -1, z: 0, w: 20, h: 2, d: 20 },
    { x: 0, y: 5.5, z: 0, w: 6, h: 1, d: 6 }, // raised center pad
    { x: 18, y: -1, z: 0, w: 8, h: 2, d: 8 },
    { x: -18, y: -1, z: 0, w: 8, h: 2, d: 8 },
    { x: 0, y: -1, z: 18, w: 8, h: 2, d: 8 },
    { x: 0, y: -1, z: -18, w: 8, h: 2, d: 8 },
  ],
  spawnPoints: [
    { x: 18, y: 0, z: 0, yaw: Math.PI / 2 },
    { x: -18, y: 0, z: 0, yaw: -Math.PI / 2 },
    { x: 0, y: 0, z: 18, yaw: Math.PI },
    { x: 0, y: 0, z: -18, yaw: 0 },
    { x: 7, y: 0, z: 7, yaw: Math.PI * 0.75 },
    { x: -7, y: 0, z: -7, yaw: -Math.PI * 0.25 },
    { x: 7, y: 0, z: -7, yaw: Math.PI * 0.25 },
    { x: -7, y: 0, z: 7, yaw: -Math.PI * 0.75 },
  ],
  pickupSpots: [
    { x: 0, y: 6, z: 0, weight: 2 }, // the contested top pad
    { x: 18, y: 0, z: 0 },
    { x: -18, y: 0, z: 0 },
    { x: 0, y: 0, z: 18 },
    { x: 0, y: 0, z: -18 },
    { x: 5, y: 0, z: 0 },
    { x: -5, y: 0, z: 0 },
  ],
  killY: -30,
  theme: {
    platform: 0x5a6472,
    accent: 0xd97b29,
    skyTop: 0x10141f,
    skyBottom: 0x2c3550,
    fog: 0x161b29,
    sun: 0xfff2dd,
  },
};
