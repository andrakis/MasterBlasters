// Game modes as a strategy over one shared round loop (world.ts). A "team" here is
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

// The elimination / lives-leader rules that used to live here run in the
// CoreFrame VM now (src/rules/mb_rules_core.c); the World adopts its verdicts.

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
