// The knockback formula and hit application — the design's one sacred rule:
// damage never kills, it only makes the next hit worse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/config.ts';
import { applyHit, applySplash, knockbackMagnitude } from '../src/sim/combat.ts';
import type { SimEvent } from '../src/sim/types.ts';
import { makeTestPlayer } from './helpers.ts';

test('knockback grows with damage', () => {
  const a = knockbackMagnitude(10, 80, 1, 1);
  const b = knockbackMagnitude(30, 80, 1, 1);
  assert.ok(b > a);
});

test('a 0-hp victim flies KB_HP_SCALE+1 times as far as a full-hp one', () => {
  const full = knockbackMagnitude(20, T.PLAYER_HP, 1, 1);
  const empty = knockbackMagnitude(20, 0, 1, 1);
  assert.ok(Math.abs(empty / full - (1 + T.KB_HP_SCALE)) < 1e-9);
});

test('quad multiplies the impulse', () => {
  const normal = knockbackMagnitude(20, 50, 1, 1);
  const quad = knockbackMagnitude(20, 50, 1, T.QUAD_MULT);
  assert.ok(Math.abs(quad / normal - T.QUAD_MULT) < 1e-9);
});

test('damage clamps at 0 hp and never kills', () => {
  const p = makeTestPlayer({ hp: 10 });
  const events: SimEvent[] = [];
  applyHit(p, 1, 500, 1, 0, 0, 1, 1, events);
  assert.equal(p.hp, 0);
  assert.equal(p.alive, true);
});

test('every hit launches at least KB_UP_BIAS upward', () => {
  const p = makeTestPlayer();
  const events: SimEvent[] = [];
  applyHit(p, 1, 20, 1, -0.5, 0, 1, 1, events); // downward-ish blast direction
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  assert.ok(p.vy / speed >= T.KB_UP_BIAS - 1e-6, `up fraction ${p.vy / speed}`);
});

test('hits suppress ground grip so victims slide off edges', () => {
  const p = makeTestPlayer();
  applyHit(p, 1, 20, 1, 0, 0, 1, 1, []);
  assert.ok(p.kbLockT > 0);
  assert.equal(p.grounded, false, 'a launch, not a shove along the floor');
});

test('self-hits take reduced damage but full knockback (rocket jumps)', () => {
  const self = makeTestPlayer({ id: 3 });
  const other = makeTestPlayer({ id: 4 });
  applyHit(self, 3, 20, 0, 1, 0, 1, 1, []);
  applyHit(other, 3, 20, 0, 1, 0, 1, 1, []);
  const selfDmg = T.PLAYER_HP - self.hp;
  const otherDmg = T.PLAYER_HP - other.hp;
  assert.ok(Math.abs(selfDmg / otherDmg - T.SELF_DMG_MULT) < 1e-9);
  assert.ok(self.vy > 0, 'self-impulse applies');
});

test('splash falls off linearly and misses beyond the radius', () => {
  const near = makeTestPlayer({ id: 0, x: 1 });
  const far = makeTestPlayer({ id: 1, x: 3.5 });
  const outside = makeTestPlayer({ id: 2, x: 10 });
  const players = [near, far, outside];
  applySplash(players, 99, 0, near.y + T.PLAYER_H / 2, 0, 4, 22, 1, 1, []);
  assert.ok(near.hp < far.hp, 'closer means more damage');
  assert.equal(outside.hp, T.PLAYER_HP, 'out of radius untouched');
  assert.ok(Math.hypot(near.vx, near.vy, near.vz) > Math.hypot(far.vx, far.vy, far.vz));
});
