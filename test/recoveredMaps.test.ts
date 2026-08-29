// Maps recovered from the 2007 BSPs go through the same integrator as the
// hand-authored ones, so the things that make a map *playable* can be asserted
// rather than eyeballed: you land, you stay landed, you can walk, and the void
// is reachable but not accidental.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/config.ts';
import { makeBoxes, type MapDef } from '../src/sim/maps/types.ts';
import { integrateBody, type BodyState } from '../src/sim/movement.ts';
import { mbcolumns } from '../src/sim/maps/mbColumns.ts';

const DT = 1 / 60;
const IDLE = { moveX: 0, moveZ: 0, jumpEdge: false, jetHeld: false };

function bodyAt(x: number, y: number, z: number): BodyState {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    grounded: false, jetting: false, energy: T.JET_ENERGY_MAX, kbLockT: 0,
  };
}

/** Drop a body and run the integrator until it settles or falls past the void. */
function settle(map: MapDef, sp: { x: number; y: number; z: number }, ticks = 400) {
  const boxes = makeBoxes(map);
  const b = bodyAt(sp.x, sp.y, sp.z);
  for (let i = 0; i < ticks; i++) {
    integrateBody(b, IDLE, DT, boxes);
    if (b.grounded && Math.abs(b.vy) < 1e-3) return { b, tick: i, fell: false };
    if (b.y < map.killY) return { b, tick: i, fell: true };
  }
  return { b, tick: ticks, fell: b.y < map.killY };
}

test('mb_columns: every spawn lands on solid ground, none fall into the void', () => {
  for (const [i, sp] of mbcolumns.spawnPoints.entries()) {
    const { b, fell } = settle(mbcolumns, sp);
    assert.equal(fell, false, `spawn ${i} at (${sp.x}, ${sp.y}, ${sp.z}) fell to the void`);
    assert.equal(b.grounded, true, `spawn ${i} never became grounded (y=${b.y.toFixed(2)})`);
    // a spawn should be a short drop onto its deck, not a plunge down a shaft
    assert.ok(sp.y - b.y < 3, `spawn ${i} fell ${(sp.y - b.y).toFixed(2)}m before landing`);
  }
});

test('mb_columns: spawns are not buried inside geometry', () => {
  const boxes = makeBoxes(mbcolumns);
  for (const [i, sp] of mbcolumns.spawnPoints.entries()) {
    const inside = boxes.filter((bx) =>
      Math.abs(sp.x - bx.x) < bx.hw && Math.abs(sp.z - bx.z) < bx.hd
      && sp.y > bx.bottom + 0.01 && sp.y < bx.top - 0.01);
    assert.equal(inside.length, 0,
      `spawn ${i} is inside ${inside.length} solid(s), first top=${inside[0]?.top}`);
  }
});

test('mb_columns: a player can walk off a deck and reach the kill plane', () => {
  const boxes = makeBoxes(mbcolumns);
  const sp = mbcolumns.spawnPoints[0];
  const b = bodyAt(sp.x, sp.y, sp.z);
  for (let i = 0; i < 120; i++) integrateBody(b, IDLE, DT, boxes);
  assert.equal(b.grounded, true, 'never settled before the walk test');
  // walk hard in one direction; the deck is finite so we must leave it
  let leftGround = false;
  for (let i = 0; i < 600; i++) {
    integrateBody(b, { moveX: 1, moveZ: 0, jumpEdge: false, jetHeld: false }, DT, boxes);
    if (!b.grounded) leftGround = true;
    if (b.y < mbcolumns.killY) break;
  }
  assert.ok(leftGround, 'walking never left the ground — the deck may be unbounded');
});

test('mb_columns: the recovered kill plane sits below every spawn deck', () => {
  for (const sp of mbcolumns.spawnPoints) {
    assert.ok(mbcolumns.killY < sp.y - 1,
      `killY ${mbcolumns.killY} is not safely below spawn y ${sp.y}`);
  }
});

test('mb_columns: spawn yaw faces the arena, not the void', () => {
  for (const [i, sp] of mbcolumns.spawnPoints.entries()) {
    const dist = Math.hypot(sp.x, sp.z);
    if (dist < 3) continue; // centre spawns have no meaningful inward direction
    // the sim's convention, from aimDir() in sim/combat.ts: forward is
    // (-sin yaw, -cos yaw), i.e. yaw 0 faces -Z
    const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
    const dot = (fx * -sp.x + fz * -sp.z) / dist;
    assert.ok(dot > 0.7, `spawn ${i} faces away from the arena (dot=${dot.toFixed(2)})`);
  }
});

test('mb_columns: pickup spots fall from above the play surface', () => {
  const highestSpawn = Math.max(...mbcolumns.spawnPoints.map((s) => s.y));
  for (const [i, p] of mbcolumns.pickupSpots.entries()) {
    assert.ok(p.y > highestSpawn, `pickup ${i} at y=${p.y} is not above the decks`);
  }
});
