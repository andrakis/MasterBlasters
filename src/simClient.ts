// Main-thread bridge to the simulation worker. The worker owns all game state;
// this module (a) retains the two most recent frames so the renderer can
// interpolate between fixed ticks, (b) routes sim events to the store (HUD) and
// to imperative drains (effects), and (c) sends fire-and-forget commands.
//
// In phase 2 this file grows a twin: the same Frame flow fed by network snapshots
// instead of a local worker. Nothing above it needs to know the difference.

import { STRIDE } from './config.ts';
import type { MatchSettings, UserCmd } from './protocol.ts';
import type { SimEvent } from './sim/types.ts';
import type { Score } from './sim/world.ts';
import { useStore } from './store.ts';

export interface RoundInfo {
  phase: 'countdown' | 'active' | 'roundEnd' | 'matchEnd';
  roundNumber: number;
  suddenDeath: boolean;
  countdownS: number;
  timeLeftS: number; // -1 when the mode has no timer
  wins: [number, number][];
}

export interface HudInfo {
  hp: number;
  energy: number;
  weapon: number;
  ammo: number[];
  lives: number;
  alive: boolean;
  quadS: number;
  respawnS: number;
  kos: number;
  falls: number;
}

export interface Frame {
  type: 'frame';
  tick: number;
  players: Float32Array; // STRIDE.PLAYER each — see world.pack()
  nPlayers: number;
  names: string[];
  projectiles: Float32Array; // STRIDE.PROJECTILE each
  nProjectiles: number;
  pickups: Float32Array; // STRIDE.PICKUP each
  nPickups: number;
  events: SimEvent[];
  matchLive: boolean;
  mapId: string;
  round: RoundInfo;
  scores: Score[];
  hud: HudInfo | null;
  simTps: number;
}

let worker: Worker | null = null;
let latest: Frame | null = null;
let prev: Frame | null = null;
let latestAt = 0;

let statsT = 0;
const STATS_THROTTLE_MS = 1000 / 10;

// Visual events (explosions, tracers) accumulate here between renderer frames;
// Effects.tsx drains them imperatively in useFrame — never through React state.
const pendingFx: SimEvent[] = [];

declare global {
  interface Window {
    __mbCmd?: (msg: Record<string, unknown>) => void;
    __mbProbe?: () => Record<string, unknown> | null;
  }
}

export function startSim(): void {
  if (worker) return;
  if (typeof window !== 'undefined') {
    window.__mbCmd = (msg) => worker?.postMessage(msg);
    window.__mbProbe = () => {
      if (!latest) return null;
      const { players, projectiles, pickups, events, ...scalars } = latest;
      return {
        ...scalars,
        px: players[1], py: players[2], pz: players[3],
        nFx: events.length,
        projCount: latest.nProjectiles,
        pickupCount: latest.nPickups,
      };
    };
  }
  worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Frame>) => {
    const m = e.data;
    if (m.type !== 'frame') return;
    prev = latest;
    latest = m;
    latestAt = performance.now();

    const s = useStore.getState();
    for (const ev of m.events) {
      switch (ev.t) {
        case 'explosion':
        case 'tracer':
        case 'saber':
          pendingFx.push(ev);
          break;
        case 'hit':
          if (ev.victim === 0) s.setHurt(ev.dmg);
          else if (ev.attacker === 0 && !ev.self) s.setHitConfirm();
          break;
        case 'ko': {
          const victim = m.names[ev.victim] ?? '?';
          const verb = ev.victim === 0 ? 'were' : 'was';
          const by = ev.attacker >= 0 ? m.names[ev.attacker] : null;
          s.pushFeed(by ? `${victim} ${verb} blasted off by ${by}` : `${victim} fell`);
          break;
        }
        case 'pickup':
          if (ev.who === 0) s.pushFeed(PICKUP_NAMES[ev.kind] ?? 'pickup', true);
          break;
        case 'drop':
          s.pushFeed(`${PICKUP_NAMES[ev.kind]} incoming!`, true);
          break;
        case 'round':
          s.setRoundEvent(ev.phase, ev.winnerTeam, ev.winnerName);
          break;
        case 'fire':
          if (ev.who === 0) {
            lastLocalFire.at = performance.now();
            lastLocalFire.weapon = ev.weapon;
          }
          break;
      }
    }

    const now = performance.now();
    if (now - statsT >= STATS_THROTTLE_MS) {
      statsT = now;
      s.setSimState({
        tick: m.tick,
        simTps: m.simTps,
        hud: m.hud,
        round: m.round,
        scores: m.scores,
        names: m.names,
        mapId: m.mapId,
        matchLive: m.matchLive,
      });
    }
  };
  worker.postMessage({ type: 'init' });
}

const PICKUP_NAMES = ['Health Pack', 'Energy Pack', 'Sniper Rifle', 'Mini Nuke', 'QUAD DAMAGE'];

export function getLatestFrame(): Frame | null {
  return latest;
}

/** Both retained frames + arrival time, for tick interpolation in useFrame. */
export function getInterpolation(): { prev: Frame | null; curr: Frame | null; currAt: number } {
  return { prev, curr: latest, currAt: latestAt };
}

/** Authoritative local-player body from the latest frame (id 0 is always slot 0). */
export function getAuthoritativeLocal(): {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  energy: number; grounded: boolean; alive: boolean;
} | null {
  if (!latest || latest.nPlayers === 0) return null;
  const p = latest.players;
  return {
    x: p[1], y: p[2], z: p[3],
    vx: p[4], vy: p[5], vz: p[6],
    energy: p[10],
    grounded: p[20] > 0.5,
    alive: p[13] > 0.5,
  };
}

// The local player's most recent confirmed shot (viewmodel kick/swing timing).
const lastLocalFire = { at: 0, weapon: 0 };
export function getLocalFire(): { at: number; weapon: number } {
  return lastLocalFire;
}

/** Drain pending visual events — called by Effects.tsx inside useFrame. */
export function drainFx(): SimEvent[] | null {
  if (pendingFx.length === 0) return null;
  const out = pendingFx.slice();
  pendingFx.length = 0;
  return out;
}

// --- commands (fire-and-forget; the worker enforces all gating) --------------------

export function sendCmd(cmd: UserCmd): void {
  worker?.postMessage({ type: 'input', cmd });
}

export function startMatch(settings: MatchSettings): void {
  pendingFx.length = 0;
  worker?.postMessage({ type: 'config', ...settings });
}

export function setPaused(paused: boolean): void {
  worker?.postMessage({ type: 'pause', paused });
}

// Offset of player record i in a frame's flat player buffer (renderer side).
export function playerAt(i: number): number {
  return i * STRIDE.PLAYER;
}
