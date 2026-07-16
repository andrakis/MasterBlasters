// The body integrator: ground snap, edge walk-off, ceiling bump, and the jetpack
// energy ledger — the physics the whole game feel hangs on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/config.ts';
import { makeBoxes } from '../src/sim/maps/types.ts';
import { integrateBody, type BodyState } from '../src/sim/movement.ts';
import { flatFloor } from './helpers.ts';

const DT = 1 / 60;

function makeBody(overrides: Partial<BodyState> = {}): BodyState {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    grounded: true, jetting: false, energy: T.JET_ENERGY_MAX, kbLockT: 0,
    ...overrides,
  };
}

const IDLE = { moveX: 0, moveZ: 0, jumpEdge: false, jetHeld: false };

test('standing still stays grounded on the platform top', () => {
  const boxes = flatFloor();
  const b = makeBody();
  for (let i = 0; i < 120; i++) integrateBody(b, IDLE, DT, boxes);
  assert.equal(b.grounded, true);
  assert.ok(Math.abs(b.y) < 1e-9, `feet stay at the top, got ${b.y}`);
});

test('walking reaches run speed and stops on the platform', () => {
  const boxes = flatFloor();
  const b = makeBody();
  for (let i = 0; i < 120; i++) integrateBody(b, { ...IDLE, moveX: 1 }, DT, boxes);
  assert.ok(Math.hypot(b.vx, b.vz) > T.RUN_SPEED * 0.95, 'approaches RUN_SPEED');
});

test('walking off the edge loses ground contact and falls', () => {
  const boxes = flatFloor(); // spans x in [-10, 10]
  const b = makeBody({ x: 9 });
  let ticks = 0;
  while (b.grounded && ticks < 300) {
    integrateBody(b, { ...IDLE, moveX: 1 }, DT, boxes);
    ticks++;
  }
  assert.equal(b.grounded, false, 'left the platform');
  for (let i = 0; i < 60; i++) integrateBody(b, IDLE, DT, boxes);
  assert.ok(b.y < -2, `fell into the void, y=${b.y}`);
});

test('jump leaves the ground and lands back', () => {
  const boxes = flatFloor();
  const b = makeBody();
  integrateBody(b, { ...IDLE, jumpEdge: true }, DT, boxes);
  assert.equal(b.grounded, false);
  assert.ok(b.vy > 0);
  let landed = false;
  for (let i = 0; i < 300; i++) {
    integrateBody(b, IDLE, DT, boxes);
    if (b.grounded) { landed = true; break; }
  }
  assert.ok(landed, 'came back down');
  assert.ok(Math.abs(b.y) < 1e-6);
});

test('a low ceiling bumps the head and zeroes upward velocity', () => {
  const boxes = makeBoxes({
    id: 'c', name: 'c',
    platforms: [
      { x: 0, y: -1, z: 0, w: 20, h: 2, d: 20 },
      { x: 0, y: 3.0, z: 0, w: 20, h: 1, d: 20 }, // ceiling bottom at 2.5
    ],
    spawnPoints: [], pickupSpots: [], killY: -30,
    theme: { platform: 0, accent: 0, skyTop: 0, skyBottom: 0, fog: 0, sun: 0 },
  });
  const b = makeBody();
  integrateBody(b, { ...IDLE, jumpEdge: true }, DT, boxes);
  let maxHead = 0;
  for (let i = 0; i < 120; i++) {
    integrateBody(b, IDLE, DT, boxes);
    maxHead = Math.max(maxHead, b.y + T.PLAYER_H);
  }
  assert.ok(maxHead <= 2.5 + 1e-6, `head stopped at the ceiling, got ${maxHead}`);
});

test('platform sides act as walls, not ledges', () => {
  const boxes = makeBoxes({
    id: 'w', name: 'w',
    platforms: [
      { x: 0, y: -1, z: 0, w: 20, h: 2, d: 20 },
      { x: 5, y: 1.5, z: 0, w: 4, h: 5, d: 4 }, // tall block on the floor
    ],
    spawnPoints: [], pickupSpots: [], killY: -30,
    theme: { platform: 0, accent: 0, skyTop: 0, skyBottom: 0, fog: 0, sun: 0 },
  });
  const b = makeBody({ x: 0 });
  for (let i = 0; i < 240; i++) integrateBody(b, { ...IDLE, moveX: 1 }, DT, boxes);
  assert.ok(b.x < 3 - T.PLAYER_R + 0.05, `blocked at the wall face, x=${b.x}`);
  assert.ok(Math.abs(b.y) < 1e-6, 'did not climb the block');
});

test('jetpack drains while thrusting, recharges after, and lifts the body', () => {
  const boxes = flatFloor();
  const b = makeBody();
  const startEnergy = b.energy;
  for (let i = 0; i < 60; i++) integrateBody(b, { ...IDLE, jetHeld: true }, DT, boxes);
  assert.ok(b.energy < startEnergy - T.JET_DRAIN * 0.9, 'burned about a second of fuel');
  assert.ok(b.y > 1, `climbed, y=${b.y}`);
  const low = b.energy;
  for (let i = 0; i < 600; i++) integrateBody(b, IDLE, DT, boxes);
  assert.ok(b.energy > low, 'recharged while idle');
});

test('jetpack cannot start from a flameout until MIN_START rebuilds', () => {
  const boxes = flatFloor();
  const b = makeBody({ energy: 0 });
  integrateBody(b, { ...IDLE, jetHeld: true }, DT, boxes);
  assert.equal(b.jetting, false, 'no thrust on fumes');
  // idle grounded until just below MIN_START — still locked out
  while (b.energy < T.JET_MIN_START - 0.5) integrateBody(b, IDLE, DT, boxes);
  integrateBody(b, { ...IDLE, jetHeld: true }, DT, boxes);
  assert.equal(b.jetting, false, 'still locked below MIN_START');
  while (b.energy < T.JET_MIN_START + 1) integrateBody(b, IDLE, DT, boxes);
  integrateBody(b, { ...IDLE, jetHeld: true }, DT, boxes);
  assert.equal(b.jetting, true, 'relights above MIN_START');
});
