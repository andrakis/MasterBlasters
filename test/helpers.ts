// Shared scaffolding for the headless sim tests: hand-built players, boxes, and
// a match driver that runs a World through its countdown into live play.

import { TUNING as T, WPN } from '../src/config.ts';
import type { MatchSettings } from '../src/protocol.ts';
import type { MapDef } from '../src/sim/maps/types.ts';
import { makeBoxes, type Box } from '../src/sim/maps/types.ts';
import type { PlayerCore } from '../src/sim/types.ts';
import { World } from '../src/sim/world.ts';

export function makeTestPlayer(overrides: Partial<PlayerCore> = {}): PlayerCore {
  return {
    id: 0, team: 0, bot: false, name: 'test', ninja: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    hp: T.PLAYER_HP,
    energy: T.JET_ENERGY_MAX,
    weapon: WPN.ROCKET,
    ammo: [-1, -1, 0, 0],
    lives: T.LIVES,
    alive: true,
    respawnAtTick: 0,
    grounded: true,
    jetting: false,
    quadUntilTick: 0,
    kbLockT: 0,
    cooldownUntilTick: 0,
    kos: 0,
    falls: 0,
    prevButtons: 0,
    lastHitBy: -1,
    lastHitTick: -1_000_000,
    ...overrides,
  };
}

/** A single 20x20 floor with its top at y=0, nothing else. */
export function flatFloor(): Box[] {
  const map: MapDef = {
    id: 'floor', name: 'floor',
    platforms: [{ x: 0, y: -1, z: 0, w: 20, h: 2, d: 20 }],
    spawnPoints: [{ x: 0, y: 0, z: 0, yaw: 0 }],
    pickupSpots: [],
    killY: -30,
    theme: { platform: 0, accent: 0, skyTop: 0, skyBottom: 0, fog: 0, sun: 0 },
  };
  return makeBoxes(map);
}

export const DEFAULT_SETTINGS: MatchSettings = {
  mapId: 'mb_test',
  mode: 'lms',
  lives: 4,
  botCount: 1,
  botTier: 2,
  seed: 12345,
};

/** New world with a live match, stepped through the countdown into active play. */
export function liveWorld(overrides: Partial<MatchSettings> = {}): World {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const w = new World(settings.seed);
  w.apply({ type: 'config', ...settings });
  while (w.round.phase === 'countdown') w.step();
  return w;
}

/** Step until the predicate holds or maxTicks elapse; returns ticks consumed. */
export function stepUntil(w: World, pred: () => boolean, maxTicks: number): number {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return i;
    w.step();
  }
  return maxTicks;
}
