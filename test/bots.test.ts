// Bot behavior, tested the Banner way: whole headless matches, asserting on
// outcomes (KOs happen, recovery works, tiers differ) rather than internals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../src/config.ts';
import { overAnyPlatform } from '../src/sim/collision.ts';
import { liveWorld, stepUntil } from './helpers.ts';

test('a Master bot knocks an idle dummy off within 90 sim-seconds', () => {
  const w = liveWorld({ botCount: 1, botTier: 2, lives: 4, seed: 777 });
  const human = w.players[0]; // never sends input: a standing dummy
  stepUntil(w, () => human.falls > 0, 90 * CFG.TICK_HZ);
  assert.ok(human.falls > 0, 'dummy got blasted off at least once');
});

test('a bot knocked into the void with fuel recovers to a platform', () => {
  let recoveries = 0;
  const trials = 5;
  for (let s = 0; s < trials; s++) {
    const w = liveWorld({ botCount: 1, botTier: 2, seed: 1000 + s });
    const bot = w.players[1];
    // hurl the bot off the edge, well outside any platform, with full fuel
    bot.x = 30;
    bot.y = 2;
    bot.z = 0;
    bot.vx = 8;
    bot.vy = 2;
    bot.energy = 100;
    bot.grounded = false;
    const before = bot.falls;
    stepUntil(w, () => bot.grounded || bot.falls > before, 15 * CFG.TICK_HZ);
    if (bot.grounded && bot.falls === before && overAnyPlatform(bot.x, bot.z, 0, w.boxes)) {
      recoveries++;
    }
  }
  assert.ok(recoveries >= 4, `recovered ${recoveries}/${trials} trials`);
});

test('Master beats Greenhorn across seeds (tiers are real skill)', () => {
  let masterWins = 0;
  const trials = 3;
  for (let s = 0; s < trials; s++) {
    const w = liveWorld({ botCount: 2, botTier: 2, lives: 2, seed: 4200 + s });
    // human dummy out of the fight: park them in the void with no lives impact —
    // simplest is to let them fall once with 1 life... instead give tier contrast:
    w.botStates.get(1)!.tier = 2; // Master
    w.botStates.get(2)!.tier = 0; // Greenhorn
    const human = w.players[0];
    human.lives = 1;
    human.y = w.map.killY - 5; // eliminate the dummy immediately
    const master = w.players[1];
    const green = w.players[2];
    stepUntil(w, () => w.round.phase !== 'active', 240 * CFG.TICK_HZ);
    // whoever still stands (or holds more lives) took the round
    const masterScore = master.lives + (master.alive ? 1 : 0);
    const greenScore = green.lives + (green.alive ? 1 : 0);
    if (masterScore > greenScore) masterWins++;
  }
  assert.ok(masterWins >= 2, `Master won ${masterWins}/${trials}`);
});

test('bots do not walk off edges while fighting', () => {
  const w = liveWorld({ botCount: 3, botTier: 1, seed: 99 });
  const bots = w.players.slice(1);
  let unforcedFalls = 0;
  for (let i = 0; i < 30 * CFG.TICK_HZ; i++) {
    w.step();
    for (const b of bots) {
      // a fall with full-ish hp and no recent hit is an unforced error
      if (!b.alive && b.hp > 80 && w.tick - b.lastHitTick > 5 * CFG.TICK_HZ) unforcedFalls++;
    }
    if (w.round.phase !== 'active') break;
  }
  assert.ok(unforcedFalls < 3, `unforced falls: ${unforcedFalls}`);
});
