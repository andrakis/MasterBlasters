#!/usr/bin/env node
// Convert a Source BSP into a `MapDef` source file for the sim.
//
//   node tools/bsp/bsp2mapdef.mjs <map.bsp> --out src/sim/maps/mb_columns.ts
//
// This is the *game* path and it is lossy on purpose: the sim collides against
// axis-aligned boxes, so every brush becomes its AABB. Angled brushes are
// reported so they can be hand-authored rather than silently squared off.
// The faithful geometry lives in the viewer (extract.mjs), not here.
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Bsp, CONTENTS } from './lib/bsp.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const bspPath = argv[0];
const outPath = flag('--out', null);
const SCALE = Number(flag('--scale', 0.0254));       // 1 Hammer unit = 1 inch
const ID = flag('--id', null);
const NAME = flag('--name', null);
// Brushes bigger than this are the skybox shell / world seal, not playfield.
const MAX_SPAN = Number(flag('--max-span', 60));
if (!bspPath || !outPath) {
  console.error('usage: bsp2mapdef.mjs <map.bsp> --out <file.ts> [--scale N] [--max-span M]');
  process.exit(1);
}

const bsp = new Bsp(bspPath);
const mapId = ID ?? basename(bspPath, '.bsp');

// Source is Z-up; the sim is Y-up. Y is negated, so min/max swap on that axis.
const conv = (v) => [v[0] * SCALE, v[2] * SCALE, -v[1] * SCALE];
function aabb(mins, maxs) {
  const a = conv(mins), b = conv(maxs);
  const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i]));
  const hi = [0, 1, 2].map((i) => Math.max(a[i], b[i]));
  return { lo, hi };
}

// --- playfield origin -------------------------------------------------------
// Spawns define where play happens; recentre so the main deck sits near y=0,
// which is the convention every hand-authored map in src/sim/maps follows.
const ents = bsp.entities();
const spawnEnts = ents.filter((e) => e.classname === 'info_player_deathmatch' && e.origin);
const spawnPos = spawnEnts.map((e) => conv(e.origin.split(/\s+/).map(Number)));
const deckY = spawnPos.length ? Math.min(...spawnPos.map((p) => p[1])) : 0;
const cx = spawnPos.length ? spawnPos.reduce((s, p) => s + p[0], 0) / spawnPos.length : 0;
const cz = spawnPos.length ? spawnPos.reduce((s, p) => s + p[2], 0) / spawnPos.length : 0;
const shift = (p) => [p[0] - cx, p[1] - deckY, p[2] - cz];

// --- platforms --------------------------------------------------------------
const platforms = [];
const dropped = { shell: 0, clip: 0, water: 0, thin: 0, angled: 0 };
const angledNotes = [];

for (const b of bsp.brushes()) {
  if (b.degenerate) continue;
  if (b.contents & (CONTENTS.PLAYERCLIP | CONTENTS.MONSTERCLIP)) { dropped.clip++; continue; }
  if (b.contents & CONTENTS.WATER) { dropped.water++; continue; }
  if (!(b.contents & CONTENTS.SOLID)) continue;

  const { lo, hi } = aabb(b.mins, b.maxs);
  const size = [0, 1, 2].map((i) => hi[i] - lo[i]);
  if (Math.max(...size) > MAX_SPAN) { dropped.shell++; continue; }
  if (Math.min(...size) < 0.02) { dropped.thin++; continue; }

  const c = shift([0, 1, 2].map((i) => (lo[i] + hi[i]) / 2));
  if (!b.axisAligned) {
    dropped.angled++;
    angledNotes.push({ c, size });
  }
  platforms.push({
    x: +c[0].toFixed(2), y: +c[1].toFixed(2), z: +c[2].toFixed(2),
    w: +size[0].toFixed(2), h: +size[1].toFixed(2), d: +size[2].toFixed(2),
    approx: !b.axisAligned,
  });
}

// --- spawns -----------------------------------------------------------------
// Yaw conversion, derived rather than guessed:
//   Source facing  = (cos S, sin S) over its (x, y)
//   our facing     = (cos S, -sin S) over (x, z), since conv() negates y
//   the sim's yaw Y gives facing (-sin Y, cos Y)   [see crusher.ts spawn table]
// Solving both gives Y = -(S + 90 deg).
const spawnPoints = spawnEnts.map((e) => {
  const p = shift(conv(e.origin.split(/\s+/).map(Number)));
  const srcYaw = e.angles ? Number(e.angles.split(/\s+/)[1]) || 0 : 0;
  let yaw = -(srcYaw + 90) * Math.PI / 180;
  // normalise to (-PI, PI] so the numbers read like the hand-authored maps
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return {
    x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2),
    yaw: +yaw.toFixed(4),
  };
});

// --- pickups ----------------------------------------------------------------
// env_entity_maker is the mod's sky-drop spawner: exactly our pickup director.
const pickupSpots = ents.filter((e) => e.classname === 'env_entity_maker' && e.origin).map((e) => {
  const p = shift(conv(e.origin.split(/\s+/).map(Number)));
  return { x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2) };
});

// --- kill plane -------------------------------------------------------------
// The void trigger_hurt volumes give the real 2007 fall-out height.
const models = bsp.models();
// trigger_hurt comes in two flavours: a thin slab under the arena (the real
// fall-out plane) and a map-sized volume that seals the world. Take the highest
// slab that still sits below the deck; fall back only if there is none.
const killCandidates = [];
for (const e of ents) {
  if (e.classname !== 'trigger_hurt' || !e.model?.startsWith('*')) continue;
  const m = models[+e.model.slice(1)];
  if (!m) continue;
  const { lo, hi } = aabb(m.mins, m.maxs);
  const top = shift([0, hi[1], 0])[1];
  const span = hi[1] - lo[1];
  if (top < -1) killCandidates.push({ top, span });
}
killCandidates.sort((a, b) => b.top - a.top);
const killY = killCandidates.length ? killCandidates[0].top : -30;

// --- theme ------------------------------------------------------------------
// Derive the palette from the map's own data rather than guessing: surface
// colour from texdata reflectivity, light colour from the dominant `light`
// entity. mb_columns turns out to be cyan-lit, which no amount of looking at
// the sandstone texture set would have told us.
const hex = (r, g, b) => (Math.round(Math.max(0, Math.min(255, r))) << 16)
  | (Math.round(Math.max(0, Math.min(255, g))) << 8) | Math.round(Math.max(0, Math.min(255, b)));

const refl = bsp.texdata().filter((t) => !/^tools[\/\\]/i.test(t.name));
const avg = [0, 1, 2].map((i) => refl.reduce((s, t) => s + t.reflectivity[i], 0) / Math.max(1, refl.length));
// reflectivity is linear 0..1; lift to a readable sRGB-ish surface tone
const platform = hex(...avg.map((v) => 255 * Math.pow(Math.min(1, v * 1.6), 1 / 2.2)));

const lightTally = new Map();
for (const e of ents) {
  if (!/^light/.test(e.classname ?? '') || !e._light) continue;
  const [r, g, b, bright = 200] = e._light.split(/\s+/).map(Number);
  const k = `${r},${g},${b}`;
  const cur = lightTally.get(k) ?? { r, g, b, bright, n: 0 };
  cur.n++; lightTally.set(k, cur);
}
const dom = [...lightTally.values()].sort((a, b) => b.n - a.n)[0] ?? { r: 255, g: 235, b: 200, n: 0 };
const norm = 255 / Math.max(dom.r, dom.g, dom.b, 1);
const lr = dom.r * norm, lg = dom.g * norm, lb = dom.b * norm;
const theme = {
  platform,
  accent: hex(lr, lg, lb),
  skyTop: hex(lr * 0.04, lg * 0.05, lb * 0.06),
  skyBottom: hex(lr * 0.13, lg * 0.19, lb * 0.22),
  fog: hex(lr * 0.08, lg * 0.12, lb * 0.14),
  sun: hex(160 + lr * 0.37, 160 + lg * 0.37, 160 + lb * 0.37),
};
const themeNote = dom.n
  ? `Palette derived from the map's own data: ${dom.n} x light "${dom.r} ${dom.g} ${dom.b}"\n  // and the mean texdata reflectivity of its ${refl.length} materials.`
  : 'Palette derived from mean texdata reflectivity; the map declares no light entities.';

const out = `// ${mapId.toUpperCase()} — recovered from the 2007 HL2 mod BSP.
//
// GENERATED by tools/bsp/bsp2mapdef.mjs from maps/${basename(bspPath)}; see
// docs/ASSET-RECOVERY.md. Geometry is the brush AABBs, so this is the massing of
// the original, not its detail. Hand-edit freely — this file is checked in and
// regenerating it is a deliberate act, not part of the build.
//
// Original scripting (point_template crate spawners, logic_case/logic_timer drop
// director) is intentionally NOT ported; the sim owns that behaviour.
${angledNotes.length ? `//
// ${angledNotes.length} of ${platforms.length} brushes were not axis-aligned and have been
// squared off to their bounding box (marked \`approx\` in the source data).` : ''}
import type { MapDef } from './types.ts';

export const ${mapId.replace(/[^a-z0-9]/gi, '')}: MapDef = {
  id: '${mapId}',
  name: '${NAME ?? mapId.replace(/^mb_/, 'MB ').toUpperCase()}',
  platforms: [
${platforms.map((p) => `    { x: ${p.x}, y: ${p.y}, z: ${p.z}, w: ${p.w}, h: ${p.h}, d: ${p.d} },${p.approx ? ' // approx (angled brush)' : ''}`).join('\n')}
  ],
  spawnPoints: [
${spawnPoints.map((s) => `    { x: ${s.x}, y: ${s.y}, z: ${s.z}, yaw: ${s.yaw} },`).join('\n')}
  ],
  pickupSpots: [
${pickupSpots.map((p) => `    { x: ${p.x}, y: ${p.y}, z: ${p.z} },`).join('\n')}
  ],
  killY: ${killY.toFixed(2)},
  // ${themeNote}
  theme: {
    platform: 0x${theme.platform.toString(16).padStart(6, '0')},
    accent: 0x${theme.accent.toString(16).padStart(6, '0')},
    skyTop: 0x${theme.skyTop.toString(16).padStart(6, '0')},
    skyBottom: 0x${theme.skyBottom.toString(16).padStart(6, '0')},
    fog: 0x${theme.fog.toString(16).padStart(6, '0')},
    sun: 0x${theme.sun.toString(16).padStart(6, '0')},
  },
};
`;
writeFileSync(outPath, out);

// Optional JSON twin so the viewer can overlay the converted collision boxes on
// the original faces — the only honest way to see what the conversion lost.
const jsonOut = flag('--json', null);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    id: mapId, platforms, spawnPoints, pickupSpots, killY, theme,
  }));
  console.log(`  json -> ${jsonOut}`);
}

console.log(`${mapId} -> ${outPath}`);
console.log(`  platforms: ${platforms.length} (${dropped.angled} squared off from angled brushes)`);
console.log(`  spawns: ${spawnPoints.length}  pickups: ${pickupSpots.length}  killY: ${killY.toFixed(2)}`);
console.log(`  dropped: ${JSON.stringify(dropped)}`);
const ext = [0, 1, 2].map((i) => {
  const k = 'xyz'[i], s = 'whd'[i];
  const lo = Math.min(...platforms.map((p) => p[k] - p[s] / 2));
  const hi = Math.max(...platforms.map((p) => p[k] + p[s] / 2));
  return `${k} ${lo.toFixed(1)}..${hi.toFixed(1)}`;
});
console.log(`  playfield (m): ${ext.join('  ')}`);
