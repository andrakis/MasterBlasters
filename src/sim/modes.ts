// Game modes as a strategy over one shared round loop (round.ts). A "team" here is
// the scoring unit: in FFA modes every player is their own team (team id = slot),
// in Team mode it's Masters (0, ninjas) vs Blasters (1, cowboys).

import type { PlayerCore } from './types.ts';

export interface ModeRules {
  id: 'lms' | 'team' | 'timed';
  usesTimer: boolean;
  friendlyFire: boolean;
  assignTeam(slot: number): number;
  teamName(team: number, players: readonly PlayerCore[]): string;
}

/** A player still matters to the round if they're alive or have a respawn coming. */
export function inContention(p: PlayerCore): boolean {
  return p.alive || p.lives > 0;
}

/**
 * Elimination check shared by every mode: the round is decided when at most one
 * team still has players in contention. Returns the winning team id, -1 for a
 * mutual wipe (draw), or null while the round should continue.
 */
export function eliminationWinner(players: readonly PlayerCore[]): number | null {
  let team = -2;
  for (const p of players) {
    if (!inContention(p)) continue;
    if (team === -2) team = p.team;
    else if (p.team !== team) return null; // two teams still standing
  }
  return team === -2 ? -1 : team;
}

/** Total remaining lives per team — the Timed mode's scoreboard. */
export function teamLives(players: readonly PlayerCore[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const p of players) {
    const lives = p.lives + (p.alive ? 1 : 0); // a living body is worth its stock + itself
    totals.set(p.team, (totals.get(p.team) ?? 0) + lives);
  }
  return totals;
}

/** The unique team with the most lives, or null on a tie (-> sudden death). */
export function livesLeader(players: readonly PlayerCore[]): number | null {
  let best = -1;
  let bestLives = -1;
  let tied = false;
  for (const [team, lives] of teamLives(players)) {
    if (lives > bestLives) {
      best = team;
      bestLives = lives;
      tied = false;
    } else if (lives === bestLives) {
      tied = true;
    }
  }
  return tied || best === -1 ? null : best;
}

function soloTeamName(team: number, players: readonly PlayerCore[]): string {
  const p = players.find((q) => q.team === team);
  return p ? p.name : '?';
}

export const MODES: Record<'lms' | 'team' | 'timed', ModeRules> = {
  lms: {
    id: 'lms',
    usesTimer: false,
    friendlyFire: true,
    assignTeam: (slot) => slot,
    teamName: soloTeamName,
  },
  team: {
    id: 'team',
    usesTimer: false,
    friendlyFire: false,
    assignTeam: (slot) => slot % 2,
    teamName: (team) => (team === 0 ? 'The Masters' : 'The Blasters'),
  },
  timed: {
    id: 'timed',
    usesTimer: true,
    friendlyFire: true,
    assignTeam: (slot) => slot,
    teamName: soloTeamName,
  },
};
