// Human-rate UI state shared between the HUD and the canvas. Per-frame sim data
// never lives here (see simClient.ts for the throttle); the hot path — instance
// matrices, the camera — is written imperatively in useFrame.

import { create } from 'zustand';
import { TUNING } from './config.ts';
import { MAPS } from './sim/maps/index.ts';
import type { MatchSettings } from './protocol.ts';
import type { HudInfo, RoundInfo } from './simClient.ts';
import type { Score } from './sim/world.ts';

export interface FeedItem {
  id: number;
  text: string;
  good: boolean; // pickups/announcements vs kill feed
  at: number;
}

export interface Banner {
  title: string;
  sub: string;
  at: number;
}

interface SimState {
  tick: number;
  simTps: number;
  hud: HudInfo | null;
  round: RoundInfo | null;
  scores: Score[];
  names: string[];
  mapId: string;
  matchLive: boolean;
}

export interface NetState {
  role: 'local' | 'host' | 'client';
  roomCode: string;
  roster: string[];
  connected: boolean;
  error: string;
}

interface UiState extends SimState {
  appPhase: 'menu' | 'playing';
  settings: MatchSettings;
  camMode: 'fp' | 'tp';
  pointerLocked: boolean;
  fps: number;
  feed: FeedItem[];
  banner: Banner | null;
  lastHurtAt: number;
  lastHurtAmount: number;
  lastHitConfirmAt: number;
  net: NetState;
  netKbps: number;
  playerName: string;

  setSimState: (s: Partial<SimState>) => void;
  setNet: (n: Partial<NetState>) => void;
  setNetKbps: (v: number) => void;
  setPlayerName: (name: string) => void;
  setAppPhase: (p: 'menu' | 'playing') => void;
  setSettings: (s: Partial<MatchSettings>) => void;
  setCamMode: (m: 'fp' | 'tp') => void;
  setPointerLocked: (v: boolean) => void;
  setFps: (fps: number) => void;
  pushFeed: (text: string, good?: boolean) => void;
  setRoundEvent: (phase: RoundInfo['phase'], winnerTeam: number, winnerName: string) => void;
  setHurt: (amount: number) => void;
  setHitConfirm: () => void;

  /** DEV: the C4KE console over the game (tilde); text is what the kernel printed, last 32K chars,
   *  with ANSI escapes kept for the renderer. ESC[2J and ESC[H mark where "the screen" starts: the next
   *  printed text after a home replaces what was drawn since, so raycast's frames update in place */
  consoleOpen: boolean;
  consoleText: string;
  consoleScreenStart: number;
  consoleHome: boolean;
  /** raw keys: every keystroke goes to the shell at once (a program reading keys, like raycast) */
  consoleRaw: boolean;
  setConsoleOpen: (v: boolean) => void;
  setConsoleRaw: (v: boolean) => void;
  appendConsole: (text: string) => void;
}

const CONSOLE_KEEP = 32768;
/** fold clear-screen and cursor-home into the log: text after a home overwrites the current screen */
function foldConsole(prev: string, screenStart: number, home: boolean, incoming: string): { text: string; screenStart: number; home: boolean } {
  let text = prev;
  const re = /\x1b\[(2J|H)/g;
  let at = 0, m: RegExpExecArray | null;
  const put = (chunk: string) => {
    if (!chunk) return;
    if (home) { text = text.slice(0, screenStart); home = false; }
    text += chunk;
  };
  while ((m = re.exec(incoming))) {
    put(incoming.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] === '2J') { screenStart = text.length; home = true; }
    else home = true;
  }
  put(incoming.slice(at));
  if (text.length > CONSOLE_KEEP) { const cut = text.length - CONSOLE_KEEP; text = text.slice(cut); screenStart = Math.max(0, screenStart - cut); }
  return { text, screenStart, home };
}

let nextFeedId = 1;
const FEED_TTL_MS = 5000;

// `?map=<id>` preselects a map (the CoreFrame editor's Play button opens the
// game this way after saving); unknown ids fall back to the default.
const urlMap = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('map');
const initialMapId = urlMap && urlMap in MAPS ? urlMap : 'mb_test';

export const useStore = create<UiState>((set) => ({
  consoleOpen: false,
  consoleText: '',
  consoleScreenStart: 0,
  consoleHome: false,
  consoleRaw: false,
  setConsoleOpen: (v) => set({ consoleOpen: v }),
  setConsoleRaw: (v) => set({ consoleRaw: v }),
  appendConsole: (text) => set((s) => { const f = foldConsole(s.consoleText, s.consoleScreenStart, s.consoleHome, text); return { consoleText: f.text, consoleScreenStart: f.screenStart, consoleHome: f.home }; }),
  tick: 0,
  simTps: 0,
  hud: null,
  round: null,
  scores: [],
  names: [],
  mapId: initialMapId,
  matchLive: false,

  appPhase: 'menu',
  settings: {
    mapId: initialMapId,
    mode: 'lms',
    lives: TUNING.LIVES,
    botCount: 3,
    botTier: 1,
    seed: 1,
  },
  camMode: 'fp',
  pointerLocked: false,
  fps: 0,
  feed: [],
  banner: null,
  lastHurtAt: 0,
  lastHurtAmount: 0,
  lastHitConfirmAt: 0,
  net: { role: 'local', roomCode: '', roster: [], connected: false, error: '' },
  netKbps: 0,
  playerName: (typeof localStorage !== 'undefined' && localStorage.getItem('mb-name')) || 'Blaster',

  setSimState: (s) => set(s),
  setNet: (n) => set((st) => ({ net: { ...st.net, ...n } })),
  setNetKbps: (netKbps) => set({ netKbps }),
  setPlayerName: (playerName) => {
    try {
      localStorage.setItem('mb-name', playerName);
    } catch {
      // storage may be unavailable; the name just won't persist
    }
    set({ playerName });
  },
  setAppPhase: (appPhase) => set({ appPhase }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setCamMode: (camMode) => set({ camMode }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setFps: (fps) => set({ fps }),
  pushFeed: (text, good = false) =>
    set((st) => {
      const now = performance.now();
      const alive = st.feed.filter((f) => now - f.at < FEED_TTL_MS);
      return { feed: [...alive.slice(-5), { id: nextFeedId++, text, good, at: now }] };
    }),
  setRoundEvent: (phase, winnerTeam, winnerName) =>
    set(() => {
      const at = performance.now();
      if (phase === 'countdown') return { banner: { title: 'GET READY', sub: '', at } };
      if (phase === 'active') {
        return winnerTeam === -2
          ? { banner: { title: 'SUDDEN DEATH', sub: 'next fall decides it', at } }
          : { banner: { title: 'GO!', sub: '', at } };
      }
      if (phase === 'roundEnd') {
        return winnerTeam < 0
          ? { banner: { title: 'DRAW', sub: 'nobody survived that', at } }
          : { banner: { title: `${winnerName} wins the round`, sub: '', at } };
      }
      return { banner: { title: `${winnerName} WINS THE MATCH`, sub: '', at } };
    }),
  setHurt: (amount) => set({ lastHurtAt: performance.now(), lastHurtAmount: amount }),
  setHitConfirm: () => set({ lastHitConfirmAt: performance.now() }),
}));
