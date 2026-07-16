// Human-rate UI state shared between the HUD and the canvas. Per-frame sim data
// never lives here (see simClient.ts for the throttle); the hot path — instance
// matrices, the camera — is written imperatively in useFrame.

import { create } from 'zustand';
import { TUNING } from './config.ts';
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

  setSimState: (s: Partial<SimState>) => void;
  setAppPhase: (p: 'menu' | 'playing') => void;
  setSettings: (s: Partial<MatchSettings>) => void;
  setCamMode: (m: 'fp' | 'tp') => void;
  setPointerLocked: (v: boolean) => void;
  setFps: (fps: number) => void;
  pushFeed: (text: string, good?: boolean) => void;
  setRoundEvent: (phase: RoundInfo['phase'], winnerTeam: number, winnerName: string) => void;
  setHurt: (amount: number) => void;
  setHitConfirm: () => void;
}

let nextFeedId = 1;
const FEED_TTL_MS = 5000;

export const useStore = create<UiState>((set) => ({
  tick: 0,
  simTps: 0,
  hud: null,
  round: null,
  scores: [],
  names: [],
  mapId: 'mb_test',
  matchLive: false,

  appPhase: 'menu',
  settings: {
    mapId: 'mb_test',
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

  setSimState: (s) => set(s),
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
