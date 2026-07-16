// The arsenal: rocket flight and splash, nuke lob, sniper hitscan + occlusion,
// saber cone + jetpack drain, ammo/cooldown gating.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, TUNING as T, WEAPONS, WPN } from '../src/config.ts';
import type { PickupCore, PlayerCore, ProjectileCore, SimEvent } from '../src/sim/types.ts';
import { stepProjectiles } from '../src/sim/projectiles.ts';
import { tryFire, type FireCtx } from '../src/sim/weapons.ts';
import { makeBoxes, type Box } from '../src/sim/maps/types.ts';
import { flatFloor, makeTestPlayer } from './helpers.ts';

const DT = 1 / 60;

function ctx(players: PlayerCore[], boxes: Box[], tick = 100): FireCtx & {
  projectiles: ProjectileCore[];
  events: SimEvent[];
} {
  let id = 1;
  const projectiles: ProjectileCore[] = [];
  const pickups: PickupCore[] = [];
  const events: SimEvent[] = [];
  return {
    players, boxes, projectiles, pickups, events, tick,
    friendlyFire: true,
    nextId: () => id++,
  };
}

test('rocket flies flat, explodes on a wall, and splashes a bystander', () => {
  const boxes = makeBoxes({
    id: 'w', name: 'w',
    platforms: [
      { x: 0, y: -1, z: 0, w: 40, h: 2, d: 40 },
      { x: 0, y: 2, z: -10, w: 10, h: 6, d: 1 }, // wall downrange (yaw 0 faces -Z)
    ],
    spawnPoints: [], pickupSpots: [], killY: -30,
    theme: { platform: 0, accent: 0, skyTop: 0, skyBottom: 0, fog: 0, sun: 0 },
  });
  const shooter = makeTestPlayer({ id: 0, z: 0 });
  const bystander = makeTestPlayer({ id: 1, z: -8, x: 1.5 });
  const c = ctx([shooter, bystander], boxes);
  tryFire(shooter, c);
  assert.equal(c.projectiles.length, 1, 'rocket spawned');

  let tick = c.tick;
  for (let i = 0; i < 120 && c.projectiles.length > 0; i++) {
    tick++;
    stepProjectiles(c.projectiles, c.players, boxes, tick, DT, 1, true, -30, c.events);
  }
  assert.equal(c.projectiles.length, 0, 'rocket detonated');
  const boom = c.events.find((e): e is Extract<SimEvent, { t: 'explosion' }> => e.t === 'explosion');
  assert.ok(boom);
  assert.ok(Math.abs(boom.z - -9.5) < 1.2, `exploded at the wall, z=${boom.z}`);
  assert.ok(bystander.hp < T.PLAYER_HP, 'bystander caught the splash');
  assert.ok(!bystander.grounded && bystander.vy > 0, 'bystander launched');
});

test('nuke lobs on an arc and lands short of a flat-fired rocket', () => {
  const boxes = flatFloor(); // 20x20 floor; nuke will land on it
  const shooter = makeTestPlayer({ id: 0, ammo: [-1, -1, 0, 1], weapon: WPN.NUKE });
  const c = ctx([shooter], boxes);
  tryFire(shooter, c);
  assert.equal(c.projectiles.length, 1);
  assert.equal(shooter.ammo[WPN.NUKE], 0, 'nuke ammo spent');
  assert.equal(shooter.weapon, WPN.ROCKET, 'auto-switched off the empty tube');

  let tick = c.tick;
  for (let i = 0; i < 600 && c.projectiles.length > 0; i++) {
    tick++;
    stepProjectiles(c.projectiles, c.players, boxes, tick, DT, 1, true, -30, c.events);
  }
  const boom = c.events.find((e): e is Extract<SimEvent, { t: 'explosion' }> => e.t === 'explosion');
  assert.ok(boom, 'nuke detonated');
  assert.equal(boom.kind, 1);
  assert.ok(Math.abs(boom.z) < 10 + 1e-6 && boom.y < 1, `arced down onto the floor (z=${boom.z}, y=${boom.y})`);
});

test('sniper is hitscan: instant hit, big knockback multiplier', () => {
  const boxes = flatFloor();
  const shooter = makeTestPlayer({ id: 0, ammo: [-1, -1, 3, 0], weapon: WPN.SNIPER });
  const target = makeTestPlayer({ id: 1, z: -12 });
  const c = ctx([shooter, target], boxes);
  tryFire(shooter, c);
  assert.equal(shooter.ammo[WPN.SNIPER], 2);
  assert.ok(target.hp < T.PLAYER_HP, 'instant damage');
  assert.ok(c.events.some((e) => e.t === 'tracer'), 'tracer event fired');
  assert.ok(target.vz < 0 && target.vy > 0, 'knocked along the shot line, biased up');
});

test('platforms occlude the sniper', () => {
  const boxes = makeBoxes({
    id: 'o', name: 'o',
    platforms: [{ x: 0, y: 1, z: -6, w: 8, h: 4, d: 1 }], // wall between
    spawnPoints: [], pickupSpots: [], killY: -30,
    theme: { platform: 0, accent: 0, skyTop: 0, skyBottom: 0, fog: 0, sun: 0 },
  });
  const shooter = makeTestPlayer({ id: 0, ammo: [-1, -1, 3, 0], weapon: WPN.SNIPER });
  const target = makeTestPlayer({ id: 1, z: -12 });
  const c = ctx([shooter, target], boxes);
  tryFire(shooter, c);
  assert.equal(target.hp, T.PLAYER_HP, 'wall ate the shot');
});

test('saber hits only inside the cone and drains the victim jetpack', () => {
  const boxes = flatFloor();
  const shooter = makeTestPlayer({ id: 0, weapon: WPN.SABER });
  const inFront = makeTestPlayer({ id: 1, z: -1.6 });
  const behind = makeTestPlayer({ id: 2, z: 1.6 });
  const c = ctx([shooter, inFront, behind], boxes);
  tryFire(shooter, c);
  assert.ok(inFront.hp < T.PLAYER_HP, 'front target slashed');
  assert.equal(behind.hp, T.PLAYER_HP, 'behind untouched');
  assert.ok(
    inFront.energy <= T.JET_ENERGY_MAX - WEAPONS[WPN.SABER].energyDrain,
    'jetpack drained — the anti-recovery identity',
  );
});

test('cooldown gates refire', () => {
  const boxes = flatFloor();
  const shooter = makeTestPlayer({ id: 0 });
  const c = ctx([shooter], boxes);
  tryFire(shooter, c);
  tryFire(shooter, c); // same tick: gated
  assert.equal(c.projectiles.length, 1, 'second trigger pull gated');
  const cdTicks = Math.round(WEAPONS[WPN.ROCKET].cooldownS * CFG.TICK_HZ);
  c.tick += cdTicks + 1;
  tryFire(shooter, c);
  assert.equal(c.projectiles.length, 2, 'fires again after cooldown');
});
