// Reproducibility: the same seed + the same command script produces the same
// match, tick for tick. This is the seam phase-2 prediction replay stands on,
// and it makes any future bug reproducible from a log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN } from '../src/protocol.ts';
import { World } from '../src/sim/world.ts';
import { DEFAULT_SETTINGS } from './helpers.ts';

function runScripted(seed: number, ticks: number): World {
  const w = new World(seed);
  w.apply({ type: 'config', ...DEFAULT_SETTINGS, seed, botCount: 3, botTier: 1 });
  for (let t = 0; t < ticks; t++) {
    // deterministic input script: strafe pattern + periodic rockets + jet bursts
    const phase = t % 240;
    w.apply({
      type: 'input',
      cmd: {
        seq: t,
        buttons:
          (phase % 90 < 25 ? BTN.FIRE : 0) |
          (phase > 180 ? BTN.JUMP | BTN.JET : 0),
        moveX: phase < 120 ? 1 : -1,
        moveZ: phase % 60 < 30 ? 0.5 : -0.5,
        yaw: (t * 0.01) % (Math.PI * 2),
        pitch: 0.1,
        weapon: -1,
      },
    });
    w.step();
  }
  return w;
}

function fingerprint(w: World): string {
  return JSON.stringify({
    tick: w.tick,
    players: w.players.map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.hp, p.energy, p.lives, p.kos, p.falls, p.alive]),
    projectiles: w.projectiles.map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz]),
    pickups: w.pickups.map((p) => [p.kind, p.x, p.y, p.z, p.landed]),
    round: [w.round.phase, w.round.roundNumber, [...w.round.wins.entries()]],
    rng: [w.rngDrops.state, w.rngAi.state, w.rngSpawns.state],
  });
}

test('same seed + same command script => identical state after 30 sim-seconds', () => {
  const a = runScripted(31337, 1800);
  const b = runScripted(31337, 1800);
  assert.equal(fingerprint(a), fingerprint(b));
});

test('different seeds diverge (the RNG streams are live)', () => {
  const a = runScripted(1, 1800);
  const b = runScripted(2, 1800);
  assert.notEqual(fingerprint(a), fingerprint(b));
});
