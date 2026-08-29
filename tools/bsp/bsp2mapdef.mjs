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
import { Bsp, CONTENTS, readDispInfos, readDispVerts, buildDisplacement } from '../lib/bsp.mjs';
import { sourceYawToSimYaw, playfieldShift, makeSkyboxTest } from '../lib/sourceCoords.mjs';

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
const [cx, deckY, cz] = playfieldShift(spawnEnts.map((e) => e.origin.split(/\s+/).map(Number)), SCALE);
const shift = (p) => [p[0] - cx, p[1] - deckY, p[2] - cz];

// --- 3D skybox --------------------------------------------------------------
const skyTest = makeSkyboxTest(ents);
const inSkybox = (mins, maxs) => skyTest
  ? skyTest((mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2)
  : false;

// --- platforms --------------------------------------------------------------
const platforms = [];
const dropped = { shell: 0, clip: 0, water: 0, thin: 0, skybox: 0, angled: 0 };
const overshoot = [];

/**
 * How much bigger a brush's AABB is than the brush itself, as a volume ratio.
 *
 * This is the cost of the box-collision model on rotated geometry, and it is
 * otherwise invisible: the map renders perfectly while players bump into air.
 * Sampled on a fixed lattice rather than randomly so the tool stays deterministic.
 */
function aabbOvershoot(b) {
  const size = [0, 1, 2].map((a) => b.maxs[a] - b.mins[a]);
  if (size.some((v) => v <= 0)) return 1;
  const N = 12;
  let inside = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const p = [
      b.mins[0] + size[0] * (i + 0.5) / N,
      b.mins[1] + size[1] * (j + 0.5) / N,
      b.mins[2] + size[2] * (k + 0.5) / N,
    ];
    let ok = true;
    for (const sd of b.sides) {
      const q = sd.plane;
      if (q.n[0] * p[0] + q.n[1] * p[1] + q.n[2] * p[2] - q.d > 0.02) { ok = false; break; }
    }
    if (ok) inside++;
  }
  return inside ? (N * N * N) / inside : 1;
}
const angledNotes = [];

for (const b of bsp.brushes()) {
  if (b.degenerate) continue;
  if (b.contents & (CONTENTS.PLAYERCLIP | CONTENTS.MONSTERCLIP)) { dropped.clip++; continue; }
  if (b.contents & CONTENTS.WATER) { dropped.water++; continue; }
  if (!(b.contents & CONTENTS.SOLID)) continue;
  if (inSkybox(b.mins, b.maxs)) { dropped.skybox++; continue; }

  const { lo, hi } = aabb(b.mins, b.maxs);
  const size = [0, 1, 2].map((i) => hi[i] - lo[i]);
  if (Math.max(...size) > MAX_SPAN) { dropped.shell++; continue; }
  if (Math.min(...size) < 0.02) { dropped.thin++; continue; }

  const c = shift([0, 1, 2].map((i) => (lo[i] + hi[i]) / 2));
  if (!b.axisAligned) {
    dropped.angled++;
    angledNotes.push({ c, size });
    overshoot.push(aabbOvershoot(b));
  }
  platforms.push({
    x: +c[0].toFixed(2), y: +c[1].toFixed(2), z: +c[2].toFixed(2),
    w: +size[0].toFixed(2), h: +size[1].toFixed(2), d: +size[2].toFixed(2),
    approx: !b.axisAligned,
  });
}

// --- spawns -----------------------------------------------------------------
// Yaw conversion lives in lib/sourceCoords.mjs and is unit-tested there.
const spawnPoints = spawnEnts.map((e) => {
  const p = shift(conv(e.origin.split(/\s+/).map(Number)));
  const srcYaw = e.angles ? Number(e.angles.split(/\s+/)[1]) || 0 : 0;
  const yaw = sourceYawToSimYaw(srcYaw);
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
  // Anything at or above the lowest spawn is an out-of-bounds volume, not the
  // floor. shift() puts the lowest spawn at y=0, so that test is just top < 0.
  if (top >= 0) continue;
  killCandidates.push({ top, span: hi[1] - lo[1], damage: Number(e.damage ?? 0) });
}
// The fall-out plane is the lethal one; among equals take the highest, since a
// kill plane below a walkable deck would let players stand inside the void.
killCandidates.sort((a, b) => (b.damage >= 100) - (a.damage >= 100) || b.top - a.top);
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

// --- displacement reachability ---------------------------------------------
// Displacements render (extract.mjs) but contribute NO collision: the sim
// collides against boxes, and a heightfield is not one. That is fine only while
// the terrain sits below the kill plane, which is the case for mb_egyptarena --
// its rocky floor is scenery you see on the way down. If a future map puts
// walkable terrain above killY, players would sink into it, so say so loudly.
const dispInfos = readDispInfos(bsp);
let dispAboveKill = 0, dispTotal = 0;
if (dispInfos.length) {
  const dispVerts = readDispVerts(bsp);
  const faces = bsp.faces(), verts = bsp.vertexes(), edges = bsp.edges(), surfedges = bsp.surfedges();
  for (const f of faces) {
    if (f.dispinfo < 0) continue;
    const poly = [];
    for (let e = 0; e < f.numedges; e++) {
      const se2 = surfedges[f.firstedge + e];
      const vi = se2 >= 0 ? edges[se2 * 2] : edges[-se2 * 2 + 1];
      poly.push([verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]]);
    }
    if (poly.length !== 4) continue;
    const c = [0, 1, 2].map((a) => poly.reduce((t, p) => t + p[a], 0) / 4);
    if (skyTest && skyTest(c[0], c[1], c[2])) continue;
    dispTotal++;
    const built = buildDisplacement(dispInfos[f.dispinfo], poly, dispVerts);
    if (!built) continue;
    let top = -Infinity;
    for (let i = 0; i < built.size * built.size; i++) top = Math.max(top, built.positions[i * 3 + 2]);
    if (shift([0, top * SCALE, 0])[1] > killY) dispAboveKill++;
  }
}

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
    playfieldShift: [cx, deckY, cz],
  }));
  console.log(`  json -> ${jsonOut}`);
}

console.log(`${mapId} -> ${outPath}`);
console.log(`  platforms: ${platforms.length} (${dropped.angled} squared off from angled brushes)`);
if (overshoot.length) {
  const o = overshoot.slice().sort((a, b) => a - b);
  const med = o[o.length >> 1], p90 = o[(o.length * 0.9) | 0], worst = o[o.length - 1];
  console.log(`     collision is looser than it looks: AABB/brush volume`
    + ` median ${med.toFixed(2)}x, p90 ${p90.toFixed(2)}x, worst ${worst.toFixed(1)}x`);
  if (med > 1.6) console.log(`     !! players will bump into air around the angled geometry`);
}
console.log(`  spawns: ${spawnPoints.length}  pickups: ${pickupSpots.length}  killY: ${killY.toFixed(2)}`);
console.log(`  dropped: ${JSON.stringify(dropped)}`);
if (dispTotal) {
  console.log(`  displacements: ${dispTotal} (render-only, no collision)`);
  if (dispAboveKill) {
    console.log(`  !! ${dispAboveKill} displacement surface(s) sit ABOVE killY ${killY.toFixed(2)}.`);
    console.log(`     Players will sink into them — this map needs terrain collision.`);
  } else {
    console.log(`     all below killY ${killY.toFixed(2)} — scenery, so no collision needed`);
  }
}
const ext = [0, 1, 2].map((i) => {
  const k = 'xyz'[i], s = 'whd'[i];
  const lo = Math.min(...platforms.map((p) => p[k] - p[s] / 2));
  const hi = Math.max(...platforms.map((p) => p[k] + p[s] / 2));
  return `${k} ${lo.toFixed(1)}..${hi.toFixed(1)}`;
});
console.log(`  playfield (m): ${ext.join('  ')}`);
