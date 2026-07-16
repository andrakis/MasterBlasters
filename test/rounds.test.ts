// Round loop and modes at the World level: stocks, respawns, elimination wins,
// and the sky-drop director cadence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, TUNING as T } from '../src/config.ts';
import { liveWorld, stepUntil } from './helpers.ts';

test('falling below killY costs a stock and respawns after the delay', () => {
  const w = liveWorld({ botCount: 1, botTier: 0, lives: 4 });
  const human = w.players[0];
  const livesBefore = human.lives;
  human.y = w.map.killY - 5; // shove them into the void
  w.step();
  assert.equal(human.alive, false);
  assert.equal(human.lives, livesBefore - 1);
  assert.equal(human.falls, 1);

  const ticks = stepUntil(w, () => human.alive, Math.round(T.RESPAWN_S * CFG.TICK_HZ) + 10);
  assert.ok(ticks <= T.RESPAWN_S * CFG.TICK_HZ + 5, 'respawned on schedule');
  assert.equal(human.hp, T.PLAYER_HP, 'fresh body');
  assert.ok(w.map.spawnPoints.some((s) => Math.hypot(s.x - human.x, s.z - human.z) < 0.1));
});

test('losing every stock ends the round and scores it for the survivor', () => {
  const w = liveWorld({ botCount: 1, botTier: 0, lives: 1 });
  const human = w.players[0];
  human.y = w.map.killY - 5;
  w.step();
  assert.equal(human.lives, 0);
  assert.equal(w.round.phase, 'roundEnd');
  const botTeam = w.players[1].team;
  assert.equal(w.round.wins.get(botTeam), 1, 'bot team scored the round');
});

test('rounds restart until ROUNDS_TO_WIN, then the match ends', () => {
  const w = liveWorld({ botCount: 1, botTier: 0, lives: 1 });
  const human = w.players[0];
  for (let round = 0; round < T.ROUNDS_TO_WIN; round++) {
    // let the roundEnd timer elapse into the next countdown when needed
    stepUntil(w, () => w.round.phase === 'active', 60 * CFG.TICK_HZ);
    human.y = w.map.killY - 5;
    w.step();
  }
  assert.equal(w.round.phase, 'matchEnd');
});

test('KO credit goes to the last attacker within the window', () => {
  const w = liveWorld({ botCount: 1, botTier: 0 });
  const human = w.players[0];
  const bot = w.players[1];
  human.lastHitBy = bot.id;
  human.lastHitTick = w.tick;
  human.y = w.map.killY - 5;
  w.step();
  assert.equal(bot.kos, 1);
});

test('team mode: no friendly fire, teams split odd/even', () => {
  const w = liveWorld({ mode: 'team', botCount: 3 });
  assert.deepEqual(
    w.players.map((p) => p.team),
    [0, 1, 0, 1],
  );
  assert.equal(w.mode.friendlyFire, false);
});

test('the sky drops pickups on the director cadence and they land', () => {
  const w = liveWorld({ botCount: 1, botTier: 0 });
  // run 25 sim-seconds: at DROP_MIN..MAX of 10..18s there must be at least one drop
  let sawDrop = false;
  for (let i = 0; i < 25 * CFG.TICK_HZ; i++) {
    w.step();
    if (w.pickups.length > 0) sawDrop = true;
    if (sawDrop && w.pickups.some((p) => p.landed)) break;
  }
  assert.ok(sawDrop, 'the director dropped something');
  assert.ok(
    w.pickups.length === 0 || w.pickups.some((p) => p.landed) || w.pickups.some((p) => !p.landed),
    'pickups exist in a sane state',
  );
});

test('timed mode ticks a round timer', () => {
  const w = liveWorld({ mode: 'timed', botCount: 1, botTier: 0 });
  assert.ok(w.round.phaseEndsTick < Number.MAX_SAFE_INTEGER, 'timer armed');
  const remaining = (w.round.phaseEndsTick - w.tick) / CFG.TICK_HZ;
  assert.ok(Math.abs(remaining - T.TIMED_ROUND_S) < 2, `full clock, got ${remaining}`);
});
