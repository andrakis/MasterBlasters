// The wire codec: UserCmd and Snapshot must survive an encode/decode round trip
// within quantization error, and stay SMALL — the whole point of the snapshot
// model is low bandwidth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRIDE, P } from '../src/config.ts';
import {
  decodeCmd, decodeSnapshot, encodeCmd, encodeSnapshot, type SnapState, type UserCmd,
} from '../src/protocol.ts';
import { World } from '../src/sim/world.ts';
import { DEFAULT_SETTINGS } from './helpers.ts';

test('UserCmd round-trips within quantization and is 10 bytes', () => {
  const cmd: UserCmd = {
    seq: 4711, buttons: 5, moveX: -0.71, moveZ: 0.71,
    yaw: -2.13, pitch: 0.42, weapon: 2,
  };
  const buf = encodeCmd(cmd);
  assert.equal(buf.byteLength, 10);
  const out = decodeCmd(buf);
  assert.equal(out.seq, cmd.seq);
  assert.equal(out.buttons, cmd.buttons);
  assert.equal(out.weapon, cmd.weapon);
  assert.ok(Math.abs(out.moveX - cmd.moveX) < 0.01);
  assert.ok(Math.abs(out.moveZ - cmd.moveZ) < 0.01);
  // yaw is stored wrapped to [0, 2π)
  const dyaw = Math.abs(((out.yaw - cmd.yaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  assert.ok(dyaw < 0.001 || Math.abs(dyaw - Math.PI * 2) < 0.001, `yaw error ${dyaw}`);
  assert.ok(Math.abs(out.pitch - cmd.pitch) < 0.001);
});

function liveSnapState(): SnapState {
  const w = new World(777);
  w.apply({ type: 'config', ...DEFAULT_SETTINGS, botCount: 3, seed: 777 });
  // run into live play so there are projectiles and pickups in flight
  for (let i = 0; i < 20 * 60; i++) w.step();
  const { msg } = w.pack();
  return msg as unknown as SnapState;
}

test('Snapshot round-trips a live world within quantization error', () => {
  const s = liveSnapState();
  const buf = encodeSnapshot(s);
  const out = decodeSnapshot(buf);

  assert.equal(out.tick, s.tick);
  assert.equal(out.nPlayers, s.nPlayers);
  assert.equal(out.nProjectiles, s.nProjectiles);
  assert.equal(out.nPickups, s.nPickups);
  assert.equal(out.round.phase, s.round.phase);
  assert.equal(out.round.roundNumber, s.round.roundNumber);
  assert.deepEqual(out.round.wins, s.round.wins);

  for (let i = 0; i < s.nPlayers; i++) {
    const b = i * STRIDE.PLAYER;
    assert.equal(out.players[b + P.ID], s.players[b + P.ID]);
    assert.ok(Math.abs(out.players[b + P.X] - s.players[b + P.X]) < 1 / 32, 'x within 3 cm');
    assert.ok(Math.abs(out.players[b + P.Y] - s.players[b + P.Y]) < 1 / 32);
    assert.ok(Math.abs(out.players[b + P.Z] - s.players[b + P.Z]) < 1 / 32);
    assert.ok(Math.abs(out.players[b + P.VX] - s.players[b + P.VX]) < 1 / 100);
    assert.equal(out.players[b + P.ALIVE], s.players[b + P.ALIVE]);
    assert.equal(out.players[b + P.LIVES], s.players[b + P.LIVES]);
    assert.equal(out.players[b + P.WEAPON], s.players[b + P.WEAPON]);
    assert.equal(out.players[b + P.TEAM], s.players[b + P.TEAM]);
    assert.equal(out.players[b + P.KOS], s.players[b + P.KOS]);
    assert.equal(out.players[b + P.CMD_SEQ], s.players[b + P.CMD_SEQ]);
    assert.ok(Math.abs(out.players[b + P.HP] - Math.round(s.players[b + P.HP])) < 1);
  }
  for (let i = 0; i < s.nProjectiles; i++) {
    const b = i * STRIDE.PROJECTILE;
    assert.equal(out.projectiles[b], s.projectiles[b] & 0xffff, 'projectile id');
    assert.equal(out.projectiles[b + 1], s.projectiles[b + 1], 'kind');
    assert.ok(Math.abs(out.projectiles[b + 2] - s.projectiles[b + 2]) < 1 / 32);
    assert.ok(Math.abs(out.projectiles[b + 5] - s.projectiles[b + 5]) < 1 / 100);
  }
  for (let i = 0; i < s.nPickups; i++) {
    const b = i * STRIDE.PICKUP;
    assert.equal(out.pickups[b + 1], s.pickups[b + 1], 'pickup kind');
    assert.equal(out.pickups[b + 5], s.pickups[b + 5], 'landed flag');
  }
});

test('a busy 4-player snapshot stays small (low-bandwidth budget)', () => {
  const s = liveSnapState();
  const buf = encodeSnapshot(s);
  // 20 Hz * this size must sit way under the ~6 KB/s/client target
  assert.ok(buf.byteLength < 500, `snapshot is ${buf.byteLength} B`);
});
