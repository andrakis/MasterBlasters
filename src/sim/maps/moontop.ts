// MB_Moontop — Daedalus' map from the 2007 mod, recreated from memory: a lunar
// plateau under low gravity, with a wide main crater deck, outlying rocks across
// jetpack gaps, and two high perches. Layout is data — refine coordinates freely.

import type { MapDef } from './types.ts';

export const moontop: MapDef = {
  id: 'mb_moontop',
  name: 'MB Moontop',
  gravityMult: 0.55, // the moon part of moontop
  platforms: [
    { x: 0, y: -1.5, z: 0, w: 24, h: 3, d: 24 }, // main crater deck
    { x: 20, y: -1, z: 12, w: 7, h: 2, d: 7 },
    { x: -20, y: -1, z: 12, w: 7, h: 2, d: 7 },
    { x: 20, y: -2, z: -14, w: 7, h: 2, d: 7 },
    { x: -20, y: -2, z: -14, w: 7, h: 2, d: 7 },
    { x: 10, y: 5, z: 0, w: 5, h: 1, d: 5 }, // high perch east
    { x: -10, y: 5, z: 0, w: 5, h: 1, d: 5 }, // high perch west
    { x: 0, y: 9, z: -8, w: 4, h: 1, d: 4 }, // the top of moontop
  ],
  spawnPoints: [
    { x: 10, y: 0, z: 10, yaw: Math.PI * 0.75 },
    { x: -10, y: 0, z: 10, yaw: -Math.PI * 0.75 },
    { x: 10, y: 0, z: -10, yaw: Math.PI * 0.25 },
    { x: -10, y: 0, z: -10, yaw: -Math.PI * 0.25 },
    { x: 20, y: 0, z: 12, yaw: Math.PI / 2 },
    { x: -20, y: 0, z: 12, yaw: -Math.PI / 2 },
    { x: 20, y: -1, z: -14, yaw: Math.PI / 2 },
    { x: -20, y: -1, z: -14, yaw: -Math.PI / 2 },
  ],
  pickupSpots: [
    { x: 0, y: 9.5, z: -8, weight: 2 }, // the summit — worth the climb
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 5.5, z: 0 },
    { x: -10, y: 5.5, z: 0 },
    { x: 20, y: 0, z: 12 },
    { x: -20, y: -1, z: -14 },
  ],
  killY: -35,
  theme: {
    platform: 0x8b8e96,
    accent: 0xc7cad1,
    skyTop: 0x030408,
    skyBottom: 0x101422,
    fog: 0x0a0d16,
    sun: 0xf5f8ff,
  },
};
