// Main-thread hub between the game state source and the renderer/HUD. Three roles:
//
//   local  — the worker owns the world (single player). v1 behavior.
//   host   — same worker, PLUS: peer cmds are fed in, snapshots fan out at
//            20 Hz on WebRTC fast channels, events on the reliable ones.
//   client — no worker at all. Snapshots from the host's fast channel are
//            decoded into the SAME Frame shape; prediction runs in PlayerRig
//            by replaying unacked cmds through the shared integrator.
//
// The renderer never knows which role is active: it reads frames through
// getInterpolation()/getAuthoritativeLocal() either way.

import { CFG, STRIDE, P, TUNING } from './config.ts';
import type { MatchSettings, SnapState, UserCmd } from './protocol.ts';
import { ClientSession } from './net/client.ts';
import { HostSession } from './net/host.ts';
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

export type NetRole = 'local' | 'host' | 'client';

let worker: Worker | null = null;
let latest: Frame | null = null;
let prev: Frame | null = null;
let latestAt = 0;

let netRole: NetRole = 'local';
let localPlayerId = 0;
let hostSession: HostSession | null = null;
let clientSession: ClientSession | null = null;
let clientNames: string[] = [];
let clientMapId = 'mb_test';
let lastSnapshotTick = 0;
let netBytesWindow = 0;
let netRateAt = 0;

let statsT = 0;
const STATS_THROTTLE_MS = 1000 / 10;

// Visual events (explosions, tracers) accumulate here between renderer frames;
// Effects.tsx drains them imperatively in useFrame — never through React state.
const pendingFx: SimEvent[] = [];

// Client prediction: cmds sent but not yet folded into a snapshot (PlayerRig
// replays these through the shared integrator on every rebase).
const pendingCmds: UserCmd[] = [];

// The local player's most recent confirmed shot (viewmodel kick/swing timing).
const lastLocalFire = { at: 0, weapon: 0 };

const PICKUP_NAMES = ['Health Pack', 'Energy Pack', 'Sniper Rifle', 'Mini Nuke', 'QUAD DAMAGE'];

declare global {
  interface Window {
    __mbCmd?: (msg: Record<string, unknown>) => void;
    __mbProbe?: () => Record<string, unknown> | null;
  }
}

// --- event routing (identical for worker events and network events) ---------------

function routeEvents(events: SimEvent[], names: string[]): void {
  const s = useStore.getState();
  for (const ev of events) {
    switch (ev.t) {
      case 'explosion':
      case 'tracer':
      case 'saber':
        pendingFx.push(ev);
        break;
      case 'hit':
        if (ev.victim === localPlayerId) s.setHurt(ev.dmg);
        else if (ev.attacker === localPlayerId && !ev.self) s.setHitConfirm();
        break;
      case 'ko': {
        const isYou = ev.victim === localPlayerId;
        const victim = isYou ? 'You' : names[ev.victim] ?? '?';
        const verb = isYou ? 'were' : 'was';
        const by =
          ev.attacker < 0 ? null : ev.attacker === localPlayerId ? 'you' : names[ev.attacker];
        s.pushFeed(by ? `${victim} ${verb} blasted off by ${by}` : `${victim} fell`);
        break;
      }
      case 'pickup':
        if (ev.who === localPlayerId) s.pushFeed(PICKUP_NAMES[ev.kind] ?? 'pickup', true);
        break;
      case 'drop':
        s.pushFeed(`${PICKUP_NAMES[ev.kind]} incoming!`, true);
        break;
      case 'round':
        s.setRoundEvent(ev.phase, ev.winnerTeam, ev.winnerName);
        break;
      case 'fire':
        if (ev.who === localPlayerId) {
          lastLocalFire.at = performance.now();
          lastLocalFire.weapon = ev.weapon;
        }
        break;
    }
  }
}

// --- frame ingestion (both sources land here) --------------------------------------

function ingestFrame(m: Frame): void {
  prev = latest;
  latest = m;
  latestAt = performance.now();
  routeEvents(m.events, m.names);

  const now = performance.now();
  if (now - statsT >= STATS_THROTTLE_MS) {
    statsT = now;
    useStore.getState().setSimState({
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

  // net byte-rate meter for the debug row
  if (netRole !== 'local' && now - netRateAt >= 1000) {
    const bytes =
      netRole === 'host' ? (hostSession?.bytesOut ?? 0) : (clientSession?.bytesIn ?? 0);
    useStore.getState().setNetKbps(((bytes - netBytesWindow) / 1024) * (1000 / Math.max(1, now - netRateAt)));
    netBytesWindow = bytes;
    netRateAt = now;
  }
}

// --- the local worker (roles: local, host) -----------------------------------------

export function startSim(): void {
  if (worker) return;
  if (typeof window !== 'undefined') {
    window.__mbCmd = (msg) => worker?.postMessage(msg);
    window.__mbProbe = () => {
      if (!latest) return null;
      const { players, projectiles, pickups, events, ...scalars } = latest;
      const o = localPlayerId * STRIDE.PLAYER;
      return {
        ...scalars,
        localId: localPlayerId,
        role: netRole,
        px: players[o + P.X], py: players[o + P.Y], pz: players[o + P.Z],
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
    if (netRole === 'client') return; // clients live on snapshots, not the local worker
    ingestFrame(m);

    // host: fan out to peers — snapshot every SNAP_EVERY ticks, events as they occur
    if (netRole === 'host' && hostSession && m.matchLive) {
      if (m.tick - lastSnapshotTick >= CFG.SNAP_EVERY) {
        lastSnapshotTick = m.tick;
        hostSession.broadcastSnapshot(m as unknown as SnapState);
      }
      if (m.events.length > 0) hostSession.broadcastEvents(m.tick, m.events);
      if (m.names.length !== hostSession.matchNames.length) {
        // the world generated bot names — share the full list with every peer
        hostSession.broadcastNames(m.names);
      }
    }
  };
  worker.postMessage({ type: 'init' });
}

// --- reads for the renderer ----------------------------------------------------------

export function getLatestFrame(): Frame | null {
  return latest;
}

/** Both retained frames + arrival time, for tick interpolation in useFrame. */
export function getInterpolation(): { prev: Frame | null; curr: Frame | null; currAt: number } {
  return { prev, curr: latest, currAt: latestAt };
}

export function getNetRole(): NetRole {
  return netRole;
}

export function getLocalPlayerId(): number {
  return localPlayerId;
}

export interface AuthLocal {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  energy: number;
  grounded: boolean;
  jetting: boolean;
  alive: boolean;
  tick: number;
  cmdSeq: number;
}

/** Authoritative local-player body from the latest frame. */
export function getAuthoritativeLocal(): AuthLocal | null {
  if (!latest || localPlayerId >= latest.nPlayers) return null;
  const p = latest.players;
  const o = localPlayerId * STRIDE.PLAYER;
  return {
    x: p[o + P.X], y: p[o + P.Y], z: p[o + P.Z],
    vx: p[o + P.VX], vy: p[o + P.VY], vz: p[o + P.VZ],
    energy: p[o + P.ENERGY],
    grounded: p[o + P.GROUNDED] > 0.5,
    jetting: p[o + P.JETTING] > 0.5,
    alive: p[o + P.ALIVE] > 0.5,
    tick: latest.tick,
    cmdSeq: p[o + P.CMD_SEQ],
  };
}

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

/** Client prediction: drop cmds the host has folded in, return the rest.
 *  Seqs are u16 on the wire, so the comparison is wrap-aware. */
export function prunePendingCmds(ackSeq: number): readonly UserCmd[] {
  const isAcked = (seq: number) => {
    const ahead = (seq - ackSeq + 0x10000) & 0xffff; // how far seq is PAST the ack
    return ahead === 0 || ahead > 0x8000;
  };
  let drop = 0;
  while (drop < pendingCmds.length && isAcked(pendingCmds[drop].seq)) drop++;
  if (drop > 0) pendingCmds.splice(0, drop);
  return pendingCmds;
}

// --- commands -------------------------------------------------------------------------

export function sendCmd(cmd: UserCmd): void {
  if (netRole === 'client') {
    if (pendingCmds.length < 128) pendingCmds.push({ ...cmd });
    clientSession?.sendCmd(cmd);
  } else {
    worker?.postMessage({ type: 'input', cmd, playerId: 0 });
  }
}

export function startMatch(settings: MatchSettings): void {
  pendingFx.length = 0;
  if (netRole === 'host' && hostSession) {
    const full = hostSession.startMatch(settings);
    lastSnapshotTick = 0;
    worker?.postMessage({ type: 'config', ...full });
  } else {
    worker?.postMessage({ type: 'config', ...settings });
  }
}

export function setPaused(paused: boolean): void {
  // pausing the host would pause everyone; only the pure-local game may pause
  if (netRole === 'local') worker?.postMessage({ type: 'pause', paused });
}

// --- lobby / net lifecycle --------------------------------------------------------------

export function hostLobby(name: string): void {
  if (hostSession || clientSession) return;
  netRole = 'host';
  localPlayerId = 0;
  const s = useStore.getState();
  s.setNet({ role: 'host', roomCode: '…', roster: [name], error: '', connected: true });
  hostSession = new HostSession(name, {
    onRoomCode: (code) => useStore.getState().setNet({ roomCode: code }),
    onRosterChange: (roster) => useStore.getState().setNet({ roster }),
    onPeerCmd: (playerId, cmd) => worker?.postMessage({ type: 'input', cmd, playerId }),
    onPeerLag: (playerId, ticks) => worker?.postMessage({ type: 'lag', playerId, ticks }),
    onError: (message) => useStore.getState().setNet({ error: message }),
  });
}

export function joinLobby(code: string, name: string): void {
  if (hostSession || clientSession) return;
  netRole = 'client';
  worker?.postMessage({ type: 'pause', paused: true }); // the host's sim is the world now
  const s = useStore.getState();
  s.setNet({ role: 'client', roomCode: code.toUpperCase(), roster: [], error: '', connected: false });
  clientSession = new ClientSession(code, name, {
    onWelcome: (playerId, roster) => {
      localPlayerId = playerId;
      useStore.getState().setNet({ connected: true, roster });
    },
    onRoster: (roster) => useStore.getState().setNet({ roster }),
    onStart: (settings, names, yourId) => {
      localPlayerId = yourId;
      clientNames = names;
      clientMapId = settings.mapId;
      pendingCmds.length = 0;
      const st = useStore.getState();
      st.setSettings(settings);
      st.setSimState({ mapId: settings.mapId, matchLive: true });
      st.setAppPhase('playing');
    },
    onNames: (names) => {
      clientNames = names;
    },
    onSnapshot: (snap) => ingestFrame(frameFromSnapshot(snap)),
    onEvents: (events) => routeEvents(events, clientNames),
    onDisconnect: (reason) => {
      useStore.getState().setNet({ error: reason, connected: false });
      leaveLobby();
    },
  });
}

export function leaveLobby(): void {
  hostSession?.close();
  clientSession?.close();
  hostSession = null;
  clientSession = null;
  if (netRole === 'client') worker?.postMessage({ type: 'pause', paused: false });
  netRole = 'local';
  localPlayerId = 0;
  pendingCmds.length = 0;
  const s = useStore.getState();
  s.setNet({ role: 'local', roomCode: '', roster: [], connected: false });
  if (s.appPhase === 'playing') s.setAppPhase('menu');
}

// --- client-side frame reconstruction ---------------------------------------------------

function frameFromSnapshot(snap: SnapState): Frame {
  const names = clientNames;
  const scores: Score[] = [];
  for (let i = 0; i < snap.nPlayers; i++) {
    const o = i * STRIDE.PLAYER;
    scores.push({
      id: snap.players[o + P.ID],
      name: names[i] ?? `P${i}`,
      team: snap.players[o + P.TEAM],
      lives: snap.players[o + P.LIVES],
      kos: snap.players[o + P.KOS],
      falls: snap.players[o + P.FALLS],
      bot: snap.players[o + P.BOT] > 0.5,
      alive: snap.players[o + P.ALIVE] > 0.5,
    });
  }
  let hud: HudInfo | null = null;
  if (localPlayerId < snap.nPlayers) {
    const o = localPlayerId * STRIDE.PLAYER;
    const p = snap.players;
    hud = {
      hp: p[o + P.HP],
      energy: p[o + P.ENERGY],
      weapon: p[o + P.WEAPON],
      ammo: [-1, -1, p[o + P.AMMO_SNIPER], p[o + P.AMMO_NUKE]],
      lives: p[o + P.LIVES],
      alive: p[o + P.ALIVE] > 0.5,
      quadS: p[o + P.QUAD_T],
      respawnS: p[o + P.RESPAWN_S],
      kos: p[o + P.KOS],
      falls: p[o + P.FALLS],
    };
  }
  return {
    type: 'frame',
    tick: snap.tick,
    players: snap.players,
    nPlayers: snap.nPlayers,
    names,
    projectiles: snap.projectiles,
    nProjectiles: snap.nProjectiles,
    pickups: snap.pickups,
    nPickups: snap.nPickups,
    events: [], // events arrive on the reliable channel, already routed
    matchLive: true,
    mapId: clientMapId,
    round: snap.round,
    scores,
    hud,
    simTps: CFG.TICK_HZ, // the host's sim rate; snapshots subsample it
  };
}

// keep TUNING referenced for HudInfo defaults used elsewhere
void TUNING;
