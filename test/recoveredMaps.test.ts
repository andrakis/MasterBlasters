// Maps recovered from the 2007 BSPs go through the same integrator as the
// hand-authored ones, so the things that make a map *playable* can be asserted
// rather than eyeballed: you land, you stay landed, you can walk, and the void
// is reachable but not accidental.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/config.ts';
import { makeBoxes, type MapDef } from '../src/sim/maps/types.ts';
import { integrateBody, type BodyState } from '../src/sim/movement.ts';
import { rayVsBoxes } from '../src/sim/collision.ts';
import { aimDir } from '../src/sim/combat.ts';
import { mbcolumns } from '../src/sim/maps/mbColumns.ts';
import { mbquake2007 } from '../src/sim/maps/mbQuake2007.ts';
import { mboutpost } from '../src/sim/maps/mbOutpost.ts';

/** Every map recovered by tools/bsp/bsp2mapdef.mjs must clear the same bar. */
const RECOVERED: MapDef[] = [mbcolumns, mbquake2007, mboutpost];

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

for (const map of RECOVERED) {
  test(`${map.id}: every spawn lands on solid ground, none fall into the void`, () => {
    for (const [i, sp] of map.spawnPoints.entries()) {
      const { b, fell } = settle(map, sp);
      assert.equal(fell, false, `spawn ${i} at (${sp.x}, ${sp.y}, ${sp.z}) fell to the void`);
      assert.equal(b.grounded, true, `spawn ${i} never became grounded (y=${b.y.toFixed(2)})`);
      // a spawn should be a short drop onto its deck, not a plunge down a shaft
      assert.ok(sp.y - b.y < 3, `spawn ${i} fell ${(sp.y - b.y).toFixed(2)}m before landing`);
    }
  });

  test(`${map.id}: spawns are not buried inside geometry`, () => {
    const boxes = makeBoxes(map);
    for (const [i, sp] of map.spawnPoints.entries()) {
      const inside = boxes.filter((bx) =>
        Math.abs(sp.x - bx.x) < bx.hw && Math.abs(sp.z - bx.z) < bx.hd
        && sp.y > bx.bottom + 0.01 && sp.y < bx.top - 0.01);
      assert.equal(inside.length, 0,
        `spawn ${i} is inside ${inside.length} solid(s), first top=${inside[0]?.top}`);
    }
  });

  test(`${map.id}: the kill plane is below every deck a spawn settles on`, () => {
    // A kill plane above a walkable surface would kill players where they stand.
    for (const [i, sp] of map.spawnPoints.entries()) {
      const { b } = settle(map, sp);
      assert.ok(b.y > map.killY,
        `spawn ${i} settles at y=${b.y.toFixed(2)}, at or below killY ${map.killY}`);
    }
  });

  test(`${map.id}: a spawn looks at the map, not into empty space`, () => {
    // "faces the arena centre" only holds for radial arenas -- mb_outpost is a
    // corridor and its spawns correctly face along it. And a single ray is a
    // pinhole: from the top of a tower it slips between distant columns. So
    // sample the actual view cone and require *something* in it.
    const boxes = makeBoxes(map);
    for (const [i, sp] of map.spawnPoints.entries()) {
      let seen = false;
      for (const dy of [-0.35, 0, 0.2]) {
        for (const dyaw of [-0.7, -0.35, 0, 0.35, 0.7]) {
          const d = aimDir(sp.yaw + dyaw, dy);
          if (rayVsBoxes(sp.x, sp.y + 0.8, sp.z, d.x, d.y, d.z, 90, boxes) < 90) { seen = true; break; }
        }
        if (seen) break;
      }
      assert.ok(seen, `spawn ${i} (yaw ${sp.yaw.toFixed(2)}) has nothing in its view cone`);
    }
  });

  test(`${map.id}: pickup spots fall from above the play surface`, () => {
    const highestSpawn = Math.max(...map.spawnPoints.map((s) => s.y));
    for (const [i, p] of map.pickupSpots.entries()) {
      assert.ok(p.y > highestSpawn, `pickup ${i} at y=${p.y} is not above the decks`);
    }
  });

  test(`${map.id}: the playfield is a sane size (no stray 3D skybox geometry)`, () => {
    const span = (k: 'x' | 'z', e: 'w' | 'd') => {
      const lo = Math.min(...map.platforms.map((p) => p[k] - p[e] / 2));
      const hi = Math.max(...map.platforms.map((p) => p[k] + p[e] / 2));
      return hi - lo;
    };
    // the hand-authored arenas run 40-70 m; anything past 120 m means a
    // sky_camera region or the world seal leaked into the collision set
    assert.ok(span('x', 'w') < 120, `x span ${span('x', 'w').toFixed(0)}m is too wide`);
    assert.ok(span('z', 'd') < 120, `z span ${span('z', 'd').toFixed(0)}m is too deep`);
  });
}

test('mb_columns: a player can walk off a deck and reach the kill plane', () => {
  const boxes = makeBoxes(mbcolumns);
  const sp = mbcolumns.spawnPoints[0];
  const b = bodyAt(sp.x, sp.y, sp.z);
  for (let i = 0; i < 120; i++) integrateBody(b, IDLE, DT, boxes);
  assert.equal(b.grounded, true, 'never settled before the walk test');
  let leftGround = false;
  for (let i = 0; i < 600; i++) {
    integrateBody(b, { moveX: 1, moveZ: 0, jumpEdge: false, jetHeld: false }, DT, boxes);
    if (!b.grounded) leftGround = true;
    if (b.y < mbcolumns.killY) break;
  }
  assert.ok(leftGround, 'walking never left the ground — the deck may be unbounded');
});
