// Multi-human worlds: a roster of two humans + a bot, per-player cmds applied by
// id, cmd-seq acks surfacing in the packed frame, and the hitscan lag rewind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, STRIDE, P, WPN } from '../src/config.ts';
import { BTN, NEUTRAL_CMD } from '../src/protocol.ts';
import { World } from '../src/sim/world.ts';
import { DEFAULT_SETTINGS } from './helpers.ts';

function twoHumanWorld(seed = 555, withBot = false): World {
  const w = new World(seed);
  w.apply({
    type: 'config', ...DEFAULT_SETTINGS, seed,
    roster: [
      { name: 'Host', bot: false },
      { name: 'Peer', bot: false },
      ...(withBot ? [{ name: '', bot: true }] : []),
    ],
  });
  while (w.round.phase === 'countdown') w.step();
  return w;
}

test('roster creates humans by name and gives bots flavor names', () => {
  const w = twoHumanWorld(555, true);
  assert.equal(w.players.length, 3);
  assert.equal(w.players[0].name, 'Host');
  assert.equal(w.players[1].name, 'Peer');
  assert.equal(w.players[1].bot, false);
  assert.equal(w.players[2].bot, true);
  assert.ok(w.players[2].name.length > 0, 'bot got a flavor name');
});

test('cmds route by playerId', () => {
  const w = twoHumanWorld(); // no bot: nobody shoves anybody

  // peer walks +x; host stands still
  w.apply({
    type: 'input', playerId: 1,
    cmd: { ...NEUTRAL_CMD, seq: 7, moveX: 1 },
  });
  const hx = w.players[0].x;
  const px = w.players[1].x;
  for (let i = 0; i < 60; i++) w.step();
  assert.ok(Math.abs(w.players[0].x - hx) < 0.01, 'host did not move');
  assert.ok(w.players[1].x - px > 5, 'peer ran');
  assert.equal(w.players[1].lastCmdSeq, 7, 'cmd seq acked on the player record');
});

test('packed frames carry the ack seq and ammo for client-side HUDs', () => {
  const w = twoHumanWorld();
  w.apply({ type: 'input', playerId: 1, cmd: { ...NEUTRAL_CMD, seq: 42 } });
  w.step();
  const { msg } = w.pack();
  const players = (msg as { players: Float32Array }).players;
  const b = 1 * STRIDE.PLAYER;
  assert.equal(players[b + P.CMD_SEQ], 42);
  assert.equal(players[b + P.AMMO_SNIPER], 0);
});

test('lag-compensated sniper hits where the shooter SAW the target', () => {
  const w = twoHumanWorld();
  const shooter = w.players[0];
  const target = w.players[1];
  // stage: target runs along +x through the shooter's crosshair line
  shooter.x = 0; shooter.z = 0; shooter.yaw = 0; shooter.pitch = 0;
  target.x = 0; target.z = -10;
  target.hp = 100;

  // history: target stood at x=0 a fifth of a second ago, then strafed hard right
  for (let i = 0; i < 12; i++) {
    w.apply({ type: 'input', playerId: 1, cmd: { ...NEUTRAL_CMD, seq: i + 1, moveX: 1 } });
    // keep the shooter parked and aiming down -z at the OLD spot
    w.apply({ type: 'input', playerId: 0, cmd: { ...NEUTRAL_CMD, seq: i + 1 } });
    w.step();
    // repin z so only x drifts (movement wobble immaterial to the test)
    target.z = -10;
  }
  const movedX = target.x;
  assert.ok(movedX > 0.9, `target cleared its old capsule (${movedX})`);

  // no lag comp: the shot at the old spot misses
  shooter.ammo[WPN.SNIPER] = 3;
  shooter.weapon = WPN.SNIPER;
  shooter.lagTicks = 0;
  shooter.cooldownUntilTick = 0;
  w.apply({ type: 'input', playerId: 0, cmd: { ...NEUTRAL_CMD, seq: 100, buttons: BTN.FIRE } });
  w.step();
  assert.equal(target.hp, 100, 'unlagged shot misses the strafing target');

  // with a 12-tick rewind the same aim connects
  w.apply({ type: 'lag', playerId: 0, ticks: 12 });
  shooter.x = 0; shooter.z = 0; shooter.yaw = 0; shooter.pitch = 0;
  shooter.cooldownUntilTick = 0;
  w.apply({ type: 'input', playerId: 0, cmd: { ...NEUTRAL_CMD, seq: 101, buttons: 0 } });
  w.step(); // release trigger so the next FIRE is an edge into a ready cooldown
  shooter.x = 0; shooter.z = 0;
  w.apply({ type: 'input', playerId: 0, cmd: { ...NEUTRAL_CMD, seq: 102, buttons: BTN.FIRE } });
  w.step();
  assert.ok(target.hp < 100, 'lag-compensated shot lands');
});

test('solo settings still synthesize You + bots (back-compat)', () => {
  const w = new World(1);
  w.apply({ type: 'config', ...DEFAULT_SETTINGS, botCount: 2, seed: 1 });
  assert.equal(w.players.length, 3);
  assert.equal(w.players[0].name, 'You');
  assert.ok(w.players[1].bot && w.players[2].bot);
  void CFG;
});
