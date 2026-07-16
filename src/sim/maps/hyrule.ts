// MB_Hyrule — the mod's Zelda homage, which in a Smash-inspired game means one
// thing: a big temple stage with side pillars and a float platform, built for
// long edge-guard duels.

import type { MapDef } from './types.ts';

export const hyrule: MapDef = {
  id: 'mb_hyrule',
  name: 'MB Hyrule',
  platforms: [
    { x: 0, y: -1.5, z: 0, w: 30, h: 3, d: 16 }, // temple main stage
    { x: 0, y: 3.5, z: -5, w: 10, h: 1, d: 4 }, // temple roof ledge
    { x: 21, y: -2.5, z: 0, w: 6, h: 2, d: 8 }, // side pillars, a step below
    { x: -21, y: -2.5, z: 0, w: 6, h: 2, d: 8 },
    { x: 0, y: 6, z: 3, w: 8, h: 0.8, d: 3 }, // the float platform
    { x: 30, y: -5, z: 0, w: 4, h: 1.5, d: 4 }, // far ledges — recovery stepping stones
    { x: -30, y: -5, z: 0, w: 4, h: 1.5, d: 4 },
  ],
  spawnPoints: [
    { x: 10, y: 0, z: 5, yaw: Math.PI * 0.75 },
    { x: -10, y: 0, z: 5, yaw: -Math.PI * 0.75 },
    { x: 10, y: 0, z: -5, yaw: Math.PI * 0.25 },
    { x: -10, y: 0, z: -5, yaw: -Math.PI * 0.25 },
    { x: 21, y: -1.5, z: 0, yaw: Math.PI / 2 },
    { x: -21, y: -1.5, z: 0, yaw: -Math.PI / 2 },
    { x: 0, y: 4, z: -5, yaw: 0 },
    { x: 0, y: 0, z: 0, yaw: 0 },
  ],
  pickupSpots: [
    { x: 0, y: 6.5, z: 3, weight: 2 }, // the float platform
    { x: 0, y: 0, z: 0 },
    { x: 8, y: 0, z: 0 },
    { x: -8, y: 0, z: 0 },
    { x: 21, y: -1.5, z: 0 },
    { x: -21, y: -1.5, z: 0 },
    { x: 0, y: 4, z: -5 },
  ],
  killY: -32,
  theme: {
    platform: 0x8a7a55,
    accent: 0x4f7a3f,
    skyTop: 0x1c2a44,
    skyBottom: 0x7a9bc4,
    fog: 0x54708f,
    sun: 0xfff0c8,
  },
};
