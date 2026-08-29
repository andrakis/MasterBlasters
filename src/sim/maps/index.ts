import type { MapDef } from './types.ts';
import { testArena } from './testArena.ts';
import { moontop } from './moontop.ts';
import { crusher } from './crusher.ts';
import { quake } from './quake.ts';
import { hyrule } from './hyrule.ts';
import { mbcolumns } from './mbColumns.ts';

export const MAPS: Record<string, MapDef> = {
  [testArena.id]: testArena,
  [moontop.id]: moontop,
  [crusher.id]: crusher,
  [quake.id]: quake,
  [hyrule.id]: hyrule,
  [mbcolumns.id]: mbcolumns,
};

export const MAP_LIST: MapDef[] = [testArena, moontop, crusher, quake, hyrule, mbcolumns];
