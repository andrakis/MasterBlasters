// MB_Quake — the mod's homage to the game that supplied half its DNA. Rusty
// verticality: a sunken center pit, corner towers, and narrow bridges that a
// rocket loves to sweep clean.

import type { MapDef } from './types.ts';

export const quake: MapDef = {
  id: 'mb_quake',
  name: 'MB Quake',
  platforms: [
    { x: 0, y: -2, z: 0, w: 14, h: 2, d: 14 }, // the pit floor
    { x: 14, y: 1, z: 14, w: 7, h: 6, d: 7 }, // corner towers
    { x: -14, y: 1, z: 14, w: 7, h: 6, d: 7 },
    { x: 14, y: 1, z: -14, w: 7, h: 6, d: 7 },
    { x: -14, y: 1, z: -14, w: 7, h: 6, d: 7 },
    { x: 14, y: 0.5, z: 0, w: 4, h: 1, d: 10 }, // rim bridges between towers
    { x: -14, y: 0.5, z: 0, w: 4, h: 1, d: 10 },
    { x: 0, y: 0.5, z: 14, w: 10, h: 1, d: 4 },
    { x: 0, y: 0.5, z: -14, w: 10, h: 1, d: 4 },
    { x: 0, y: 6.5, z: 0, w: 5, h: 1, d: 5 }, // the mega-health perch
  ],
  spawnPoints: [
    { x: 14, y: 4, z: 14, yaw: Math.PI * 0.75 },
    { x: -14, y: 4, z: 14, yaw: -Math.PI * 0.75 },
    { x: 14, y: 4, z: -14, yaw: Math.PI * 0.25 },
    { x: -14, y: 4, z: -14, yaw: -Math.PI * 0.25 },
    { x: 14, y: 1, z: 0, yaw: Math.PI / 2 },
    { x: -14, y: 1, z: 0, yaw: -Math.PI / 2 },
    { x: 0, y: 1, z: 14, yaw: Math.PI },
    { x: 0, y: 1, z: -14, yaw: 0 },
  ],
  pickupSpots: [
    { x: 0, y: 7, z: 0, weight: 3 }, // the perch — pure Quake mega-health ritual
    { x: 0, y: -1, z: 0, weight: 2 }, // the pit: grab it and get out
    { x: 14, y: 1, z: 0 },
    { x: -14, y: 1, z: 0 },
    { x: 0, y: 1, z: 14 },
    { x: 0, y: 1, z: -14 },
  ],
  killY: -30,
  theme: {
    platform: 0x74513a,
    accent: 0xa8642c,
    skyTop: 0x14090a,
    skyBottom: 0x38181a,
    fog: 0x200e10,
    sun: 0xffc890,
  },
};
