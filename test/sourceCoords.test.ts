// The Source -> sim conversions. These are pure and cheap to assert, and getting
// the yaw wrong is silent in a way that costs an afternoon: the map loads, the
// geometry is correct, and players just spawn facing the wrong way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimDir } from '../src/sim/combat.ts';
// @ts-expect-error -- build-tool module, no types
import { sourceYawToSimYaw, sourceToWorld, UNITS_TO_METERS } from '../tools/lib/sourceCoords.mjs';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('1 Hammer unit is 1 inch', () => {
  assert.equal(UNITS_TO_METERS, 0.0254);
});

test('Source Z-up maps to our Y-up with Y negated', () => {
  // a point 100 units "north" (+y) in Source is 2.54 m toward -z for us
  assert.deepEqual(sourceToWorld(0, 100, 0).map((v: number) => +v.toFixed(4)), [0, 0, -2.54]);
  // Source +z (up) becomes our +y (up)
  assert.deepEqual(sourceToWorld(0, 0, 100).map((v: number) => +v.toFixed(4)), [0, 2.54, 0]);
});

test('each cardinal Source yaw converts to the matching world direction', () => {
  // Source yaw is CCW about +Z from +X. After the Y negation:
  //   S=0   -> Source +x -> our +x
  //   S=90  -> Source +y -> our -z
  //   S=180 -> Source -x -> our -x
  //   S=270 -> Source -y -> our +z
  const cases: [number, [number, number]][] = [
    [0, [1, 0]],
    [90, [0, -1]],
    [180, [-1, 0]],
    [270, [0, 1]],
  ];
  for (const [srcYaw, [ex, ez]] of cases) {
    const d = aimDir(sourceYawToSimYaw(srcYaw), 0);
    assert.ok(near(d.x, ex, 1e-9) && near(d.z, ez, 1e-9),
      `source yaw ${srcYaw} gave (${d.x.toFixed(3)}, ${d.z.toFixed(3)}), expected (${ex}, ${ez})`);
  }
});

test('yaw conversion is normalised to (-PI, PI]', () => {
  for (let s = -720; s <= 720; s += 15) {
    const y = sourceYawToSimYaw(s);
    assert.ok(y > -Math.PI - 1e-9 && y <= Math.PI + 1e-9, `source yaw ${s} -> ${y}`);
  }
});

test('conversion round-trips through a full turn', () => {
  // 360 degrees apart must be the same facing
  for (let s = 0; s < 360; s += 30) {
    const a = aimDir(sourceYawToSimYaw(s), 0);
    const b = aimDir(sourceYawToSimYaw(s + 360), 0);
    assert.ok(near(a.x, b.x) && near(a.z, b.z), `source yaw ${s} vs ${s + 360}`);
  }
});
