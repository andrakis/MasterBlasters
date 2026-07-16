// MB_Crusher — Daedalus' map from the 2007 mod, recreated from memory: an
// industrial press floor. Sweeper blocks patrol the main deck shoving anyone in
// their path toward the void, and the side routes are moving platforms that are
// only sometimes there. Movers are pure functions of the tick (maps/types.ts).

import type { MapDef } from './types.ts';

export const crusher: MapDef = {
  id: 'mb_crusher',
  name: 'MB Crusher',
  platforms: [
    { x: 0, y: -1, z: 0, w: 34, h: 2, d: 12 }, // main press floor
    // the crushers: tall sweeper blocks patrolling across the deck
    {
      x: -8, y: 1.5, z: 0, w: 3, h: 3, d: 12,
      kind: 'mover', moveAxis: 'x', moveRange: 9, moveHz: 0.11,
    },
    {
      x: 8, y: 1.5, z: 0, w: 3, h: 3, d: 12,
      kind: 'mover', moveAxis: 'x', moveRange: 9, moveHz: 0.11, phase: Math.PI,
    },
    // ferry platforms shuttling along the flanks — the safe route, sometimes
    {
      x: 0, y: -0.5, z: 12, w: 5, h: 1, d: 4,
      kind: 'mover', moveAxis: 'x', moveRange: 13, moveHz: 0.07,
    },
    {
      x: 0, y: -0.5, z: -12, w: 5, h: 1, d: 4,
      kind: 'mover', moveAxis: 'x', moveRange: 13, moveHz: 0.07, phase: Math.PI,
    },
    // end towers overlooking the press floor
    { x: 21, y: 1, z: 0, w: 6, h: 6, d: 8 },
    { x: -21, y: 1, z: 0, w: 6, h: 6, d: 8 },
  ],
  spawnPoints: [
    { x: 21, y: 4, z: 0, yaw: Math.PI / 2 },
    { x: -21, y: 4, z: 0, yaw: -Math.PI / 2 },
    { x: 14, y: 0, z: 4, yaw: Math.PI / 2 },
    { x: -14, y: 0, z: 4, yaw: -Math.PI / 2 },
    { x: 14, y: 0, z: -4, yaw: Math.PI / 2 },
    { x: -14, y: 0, z: -4, yaw: -Math.PI / 2 },
    { x: 0, y: 0, z: 4, yaw: Math.PI },
    { x: 0, y: 0, z: -4, yaw: 0 },
  ],
  pickupSpots: [
    { x: 0, y: 0, z: 0, weight: 2 }, // dead center of the press floor
    { x: 21, y: 4, z: 0 },
    { x: -21, y: 4, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: -10, y: 0, z: 0 },
  ],
  killY: -30,
  theme: {
    platform: 0x6b5d4a,
    accent: 0xd9762b,
    skyTop: 0x1a120c,
    skyBottom: 0x3d2a18,
    fog: 0x241a10,
    sun: 0xffd9a0,
  },
};
