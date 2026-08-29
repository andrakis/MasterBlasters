import type { MapDef } from './types.ts';
import { testArena } from './testArena.ts';
import { moontop } from './moontop.ts';
import { crusher } from './crusher.ts';
import { quake } from './quake.ts';
import { hyrule } from './hyrule.ts';
import { mbcolumns } from './mbColumns.ts';
// Recovered from the 2007 BSPs (docs/ASSET-RECOVERY.md). mb_quake_2007 sits
// alongside the memory-recreated quake.ts rather than replacing it — the pair is
// worth keeping side by side.
import { mbquake2007 } from './mbQuake2007.ts';
import { mboutpost } from './mbOutpost.ts';

export const MAPS: Record<string, MapDef> = {
  [testArena.id]: testArena,
  [moontop.id]: moontop,
  [crusher.id]: crusher,
  [quake.id]: quake,
  [hyrule.id]: hyrule,
  [mbcolumns.id]: mbcolumns,
  [mbquake2007.id]: mbquake2007,
  [mboutpost.id]: mboutpost,
};

export const MAP_LIST: MapDef[] = [
  testArena, moontop, crusher, quake, hyrule,
  mbcolumns, mbquake2007, mboutpost,
];
