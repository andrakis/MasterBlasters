// Shared scaffolding for the headless sim tests: hand-built players, boxes, and
// a match driver that runs a World through its countdown into live play.

import { TUNING as T, WPN } from '../src/config.ts';
import type { MatchSettings } from '../src/protocol.ts';
import type { MapDef } from '../src/sim/maps/types.ts';
import { makeBoxes, type Box } from '../src/sim/maps/types.ts';
import type { PlayerCore } from '../src/sim/types.ts';
import { World } from '../src/sim/world.ts';
import { existsSync, readFileSync } from 'node:fs';
import { KERNEL_DISK, VmRules, bareImage, isOpnamesRom, type VmAssets } from '../src/rules/vmRules.ts';

// The rules VM, booted from the same files the browser fetches (public/coreframe).
// One machine per World: boot is a few hundred cycles, so it is cheap.
let vmAssets: VmAssets | null = null;
export function testRules(): VmRules {
  if (!vmAssets) {
    const base = new URL('../public/coreframe/', import.meta.url);
    vmAssets = {
      ucSource: readFileSync(new URL('microcode.uc', base), 'utf8'),
      fwBytes: bareImage(new Uint8Array(readFileSync(new URL('fw.c4r', base)))),
      progBytes: bareImage(new Uint8Array(readFileSync(new URL('mb_rules.c4r', base)))),
    };
    // a release build's permuted encoding, if the images were built with one
    const romFile = new URL('opnames.rom', base);
    if (existsSync(romFile)) { const rom = readFileSync(romFile, 'utf8'); if (isOpnamesRom(rom)) vmAssets.opnames = rom; }
  }
  return new VmRules(vmAssets);
}

/** the same rules under C4KE (DEV's hosting): the kernel + its disk from public/coreframe/kernel */
export function testKernelRules(): VmRules {
  testRules();
  const base = new URL('../public/coreframe/kernel/', import.meta.url);
  const files = new Map<string, Uint8Array>();
  for (const n of KERNEL_DISK) files.set(`${n}.c4r`, bareImage(new Uint8Array(readFileSync(new URL(`disk/${n}.c4r`, base)))));
  return new VmRules({ ...vmAssets!, kernel: { kernelBytes: bareImage(new Uint8Array(readFileSync(new URL('c4ke32.c4r', base)))), files } });
}

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
    lastCmdSeq: 0,
    lagTicks: 0,
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
  const w = new World(settings.seed, testRules());
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
