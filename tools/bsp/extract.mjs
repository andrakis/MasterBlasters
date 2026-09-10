#!/usr/bin/env node
// Extract renderable geometry, textures and baked lighting from a Source BSP
// into plain Three.js-ready data.
//
//   node tools/bsp/extract.mjs <map.bsp> --materials <dir> --out <dir> [--scale N]
//
// The key idea: we do not reimplement a Source renderer. Everything Source baked
// at compile time (texture vectors, lightmaps) is replayed as ordinary buffer
// attributes and a texture atlas. Runtime behaviour is left to our own sim.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { Bsp, CONTENTS, SURF, readDispInfos, readDispVerts, buildDisplacement } from '../lib/bsp.mjs';
import { readVtf } from '../lib/vtf.mjs';
import { findMaterial } from '../lib/vmt.mjs';
import { encodePng } from '../lib/png.mjs';
import { missingTexture, voidTexture } from '../lib/placeholder.mjs';
import { findSubstitute } from '../lib/substitutes.mjs';
import { playfieldShift, makeSkyboxTest } from '../lib/sourceCoords.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const bspPath = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') === false) ?? argv[0];
const materialsRoot = flag('--materials', '/home/code/git/masterblasters_hl2/materials');
const outDir = flag('--out', null);
// 1 Hammer unit = 1 inch. Overridable: arena scale is still an open design call.
const UNITS_TO_M = Number(flag('--scale', 0.0254));
const LM_BRIGHTNESS = Number(flag('--brightness', 1.0));
if (!bspPath || !outDir) {
  console.error('usage: extract.mjs <map.bsp> --materials <dir> --out <dir> [--scale 0.0254] [--brightness 1.0]');
  process.exit(1);
}

const mapName = basename(bspPath, '.bsp');
mkdirSync(join(outDir, 'textures'), { recursive: true });

const bsp = new Bsp(bspPath);
const planes = bsp.planes(), texinfo = bsp.texinfo(), texdata = bsp.texdata();
const faces = bsp.faces(), verts = bsp.vertexes(), edges = bsp.edges(), surfedges = bsp.surfedges();
const models = bsp.models(), ents = bsp.entities();
const dispInfos = readDispInfos(bsp);
const dispVerts = readDispVerts(bsp);

const lighting = bsp.lump(8); // LUMP_LIGHTING, ColorRGBExp32

// Source is Z-up / X-forward; three.js is Y-up. Also flips handedness.
// The playfield shift is applied here too, so scene.json comes out in the SAME
// space as the MapDef the sim collides against -- the game can then render this
// geometry straight over those boxes with no offset to get wrong.
const spawnOrigins = ents.filter((e) => e.classname === 'info_player_deathmatch' && e.origin)
  .map((e) => e.origin.split(/\s+/).map(Number));
const SHIFT = playfieldShift(spawnOrigins, UNITS_TO_M);
// The 3D skybox is a render trick we do not reproduce; drawing its miniature in
// place would ring the level with giant terrain. Its displacements especially.
const skyTest = makeSkyboxTest(ents);
const toThree = (x, y, z) => [
  x * UNITS_TO_M - SHIFT[0], z * UNITS_TO_M - SHIFT[1], -y * UNITS_TO_M - SHIFT[2],
];
// A direction is not a point: the playfield shift must not apply to normals.
const dirToThree = (x, y, z) => [x * UNITS_TO_M, z * UNITS_TO_M, -y * UNITS_TO_M];

// The 3D skybox. Its geometry is built at 1/scale somewhere else in the map, and the engine
// draws it scaled up around the player -- a point `p` in the sky room appears at
// `eye + (p - skyOrigin) * scale`. Emitting it RELATIVE to the sky camera and pre-scaled
// leaves a renderer one job: keep the group on the camera. It is a directional backdrop, so
// its triangles are sorted back-to-front here and drawn with no depth at all: the world
// always paints over it, and it can never occlude the arena however near a piece of it is.
const skyCam = ents.find((e) => e.classname === 'sky_camera' && e.origin);
const SKY_ORIGIN = skyCam ? skyCam.origin.split(/\s+/).map(Number) : null;
const SKY_SCALE = skyCam ? Number(skyCam.scale ?? skyCam.keys?.scale ?? 16) || 16 : 16;
const SKY_UNITS = UNITS_TO_M * SKY_SCALE;
const toSky = (x, y, z) => [
  (x - SKY_ORIGIN[0]) * SKY_UNITS, (z - SKY_ORIGIN[2]) * SKY_UNITS, -(y - SKY_ORIGIN[1]) * SKY_UNITS,
];
const dirToSky = (x, y, z) => [x, z, -y];

// ---------------------------------------------------------------- materials
// TOOLS/* are editor-only surfaces (clip, trigger, nodraw, skip). They must not
// render, but the brushes carrying them still matter for collision and bounds.
const isTool = (n) => /^tools[\/\\]/i.test(n);
const VALVE_STOCK = /^(tools|halflife|props|dev|editor|debug|engine|effects|sprites|skybox)[\/\\]/i;

const materials = new Map(); // name -> {index, file, width, height, transparent, tool, stock}
function materialFor(name) {
  if (materials.has(name)) return materials.get(name);
  const rec = { index: materials.size, name, file: null, width: 128, height: 128, transparent: false, tool: isTool(name), stock: VALVE_STOCK.test(name), missing: false, generated: false, kind: 'texture', note: null, shader: null };
  materials.set(name, rec);
  if (rec.tool) return rec;
  const found = findMaterial(materialsRoot, name);
  if (!found || !found.vtfPath) {
    rec.missing = true;
    rec.generated = true;
    // HALFLIFE/BLACK is flat black by definition — regenerate it rather than
    // flag it missing.
    const isVoid = /^halflife[\/\\]black$/i.test(name);
    const sub = isVoid ? null : findSubstitute(name);
    if (sub?.kind === 'cc0') {
      // one shared file serves every map, so reference it rather than copy it
      rec.kind = 'cc0';
      rec.file = sub.file;
      rec.note = sub.note;
      return rec;
    }
    const tex = isVoid ? voidTexture() : sub?.generate ? sub.generate() : missingTexture();
    rec.kind = isVoid ? 'void' : sub ? 'generated' : 'placeholder';
    if (sub) rec.note = sub.note;
    rec.width = tex.width; rec.height = tex.height;
    const file = `${name.replace(/[\/\\]/g, '_').toLowerCase()}.png`;
    writeFileSync(join(outDir, 'textures', file), encodePng(tex.pixels, tex.width, tex.height));
    rec.file = `textures/${file}`;
    return rec;
  }
  rec.shader = found.shader;
  try {
    const tex = readVtf(found.vtfPath);
    rec.width = tex.width; rec.height = tex.height;
    rec.transparent = /DXT5|DXT3|8888/.test(tex.format) && hasAlpha(tex.pixels);
    const file = `${name.replace(/[\/\\]/g, '_').toLowerCase()}.png`;
    writeFileSync(join(outDir, 'textures', file), encodePng(tex.pixels, tex.width, tex.height));
    rec.file = `textures/${file}`;
  } catch (e) {
    rec.missing = true;
    console.warn(`  ! ${name}: ${e.message}`);
  }
  return rec;
}
function hasAlpha(px) { for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true; return false; }

// ------------------------------------------------------------- lightmap pack
// Each face owns a small rectangle of luxels. Pack them into one atlas and hand
// three.js a uv2 channel — this replays the 2007 VRAD bake exactly, with no
// runtime lighting at all.
const lmRects = [];
for (const f of faces) {
  const w = f.lmSize[0] + 1, h = f.lmSize[1] + 1;
  const usable = f.lightofs >= 0 && f.styles[0] !== 255 && w > 0 && h > 0 && w <= 512 && h <= 512;
  lmRects.push(usable ? { w, h, face: f } : null);
}
const PAD = 1;
const order = lmRects.map((r, i) => [r, i]).filter(([r]) => r).sort((a, b) => b[0].h - a[0].h);

/** Shelf-pack the face lightmaps into a `W`-wide atlas; returns height or null. */
function shelfPack(items, W) {
  let x = 0, y = 0, shelf = 0;
  for (const [r] of items) {
    const w = r.w + PAD * 2, h = r.h + PAD * 2;
    if (w > W) return null;
    if (x + w > W) { x = 0; y += shelf; shelf = 0; }
    r.x = x + PAD; r.y = y + PAD;
    x += w; shelf = Math.max(shelf, h);
  }
  const H = y + shelf;
  return H > W * 2 ? null : H;   // keep the atlas roughly square-ish
}

let atlasW = 64, atlasH = 64;
for (;;) {
  const H = shelfPack(order, atlasW);
  if (H !== null) { atlasH = Math.max(1, 1 << Math.ceil(Math.log2(H))); break; }
  atlasW *= 2;
  if (atlasW > 8192) throw new Error('lightmap atlas would exceed 8192px');
}
shelfPack(order, atlasW);

const atlas = new Uint8Array(atlasW * atlasH * 4).fill(255);
// Faces with no bake (nodraw, skybox shells) sample pixel (0,0). Leaving it
// white blows them out; a neutral grey keeps them readable without inventing light.
const UNLIT = 160;
atlas[0] = atlas[1] = atlas[2] = UNLIT; atlas[3] = 255;
const lb = bsp.buf;
for (const [r] of order) {
  const f = r.face;
  for (let ly = 0; ly < r.h; ly++) for (let lx = 0; lx < r.w; lx++) {
    const s = lighting.ofs + f.lightofs + (ly * r.w + lx) * 4;
    const exp = lb.readInt8(s + 3), scale = Math.pow(2, exp) * LM_BRIGHTNESS;
    const d = ((r.y + ly) * atlasW + (r.x + lx)) * 4;
    for (let c = 0; c < 3; c++) {
      const lin = (lb[s + c] * scale) / 255;
      atlas[d + c] = Math.max(0, Math.min(255, 255 * Math.pow(Math.min(1, lin), 1 / 2.2))) | 0;
    }
    atlas[d + 3] = 255;
  }
  // bleed the border outward so bilinear sampling never picks up a neighbour
  const cp = (sx, sy, dx, dy) => {
    const s = ((r.y + sy) * atlasW + (r.x + sx)) * 4, e = ((r.y + dy) * atlasW + (r.x + dx)) * 4;
    for (let c = 0; c < 4; c++) atlas[e + c] = atlas[s + c];
  };
  for (let lx = 0; lx < r.w; lx++) { cp(lx, 0, lx, -1); cp(lx, r.h - 1, lx, r.h); }
  for (let ly = -1; ly <= r.h; ly++) { cp(0, Math.max(0, Math.min(r.h - 1, ly)), -1, ly); cp(r.w - 1, Math.max(0, Math.min(r.h - 1, ly)), r.w, ly); }
}
writeFileSync(join(outDir, 'lightmap.png'), encodePng(atlas, atlasW, atlasH));

// ---------------------------------------------------------------- face geo
// Faces belonging to brush entities are grouped separately so movers can be
// driven by our own sim rather than baked into the world mesh.
const faceOwner = new Array(faces.length).fill(0);
for (let m = 1; m < models.length; m++)
  for (let i = models[m].firstface; i < models[m].firstface + models[m].numfaces; i++)
    if (i < faceOwner.length) faceOwner[i] = m;

const groups = new Map();    // key `${model}:${matIndex}` -> buffers (the playfield)
const skyGroups = new Map(); // the same, for the 3D skybox
let skipped = { tool: 0, nodraw: 0, disp: 0, skybox: 0, degenerate: 0 };
let dispFaces = 0, dispTris = 0, skyFaces = 0, skyDispFaces = 0;

/**
 * A displacement contributes a grid, not a polygon fan. UVs still come from the
 * texinfo vectors applied to the DISPLACED world position — the texture projects
 * through space, exactly as it does for a flat face — and the lightmap grid
 * lines up with the vertex grid because vbsp sizes it from the same power.
 *
 * Normals are accumulated from the triangles rather than taken from the face
 * plane, which is the whole point: a displaced surface is not flat.
 */
function emitDisplacement(g, f, ti, td, rect, built, tf, dtf) {
  const { size, positions, indices } = built;
  const base = g.pos.length / 3;
  const nrm = new Float32Array(size * size * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const [ia, ib, ic] = [indices[t], indices[t + 1], indices[t + 2]];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const e1 = [positions[ib * 3] - ax, positions[ib * 3 + 1] - ay, positions[ib * 3 + 2] - az];
    const e2 = [positions[ic * 3] - ax, positions[ic * 3 + 1] - ay, positions[ic * 3 + 2] - az];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [ia, ib, ic]) for (let a = 0; a < 3; a++) nrm[v * 3 + a] += n[a];
  }
  for (let i = 0; i < size * size; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const [x, y, z] = tf(px, py, pz);
    g.pos.push(x, y, z);
    const [nx, ny, nz] = dtf(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    const nl = Math.hypot(nx, ny, nz) || 1;
    g.normal.push(nx / nl, ny / nl, nz / nl);
    const tv = ti.textureVecs;
    g.uv.push(
      (px * tv[0][0] + py * tv[0][1] + pz * tv[0][2] + tv[0][3]) / td.width,
      1 - (px * tv[1][0] + py * tv[1][1] + pz * tv[1][2] + tv[1][3]) / td.height,
    );
    if (rect) {
      const lv = ti.lightmapVecs;
      const lu = (px * lv[0][0] + py * lv[0][1] + pz * lv[0][2] + lv[0][3]) - f.lmMins[0];
      const lvv = (px * lv[1][0] + py * lv[1][1] + pz * lv[1][2] + lv[1][3]) - f.lmMins[1];
      g.uv2.push(
        (rect.x + Math.max(0, Math.min(rect.w, lu))) / atlasW,
        1 - (rect.y + Math.max(0, Math.min(rect.h, lvv))) / atlasH,
      );
    } else {
      g.uv2.push(0.5 / atlasW, 1 - 0.5 / atlasH);
    }
  }
  // toThree negates Y and so flips handedness; reverse winding to match
  for (let t = 0; t < indices.length; t += 3)
    g.idx.push(base + indices[t], base + indices[t + 2], base + indices[t + 1]);
  return indices.length / 3;
}

for (let fi = 0; fi < faces.length; fi++) {
  const f = faces[fi];
  if (f.texinfo < 0) { skipped.degenerate++; continue; }
  const ti = texinfo[f.texinfo];
  if (ti.flags & (SURF.NODRAW | SURF.SKIP | SURF.HINT | SURF.TRIGGER)) { skipped.nodraw++; continue; }
  const matName = texdata[ti.texdata]?.name;
  if (!matName) { skipped.degenerate++; continue; }
  const mat = materialFor(matName);
  if (mat.tool) { skipped.tool++; continue; }

  // walk surfedges into a polygon
  const poly = [];
  for (let e = 0; e < f.numedges; e++) {
    const se = surfedges[f.firstedge + e];
    const vi = se >= 0 ? edges[se * 2] : edges[-se * 2 + 1];
    poly.push([verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]]);
  }
  if (poly.length < 3) { skipped.degenerate++; continue; }
  let inSky = false;
  if (skyTest && SKY_ORIGIN) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of poly) { cx += p[0]; cy += p[1]; cz += p[2]; }
    inSky = skyTest(cx / poly.length, cy / poly.length, cz / poly.length);
    if (inSky) skyFaces++;
  }
  const [tf, dtf] = inSky ? [toSky, dirToSky] : [toThree, dirToThree];
  const into = inSky ? skyGroups : groups;

  const key = `${faceOwner[fi]}:${mat.index}`;
  let g = into.get(key);
  if (!g) { g = { model: faceOwner[fi], material: mat.index, pos: [], uv: [], uv2: [], idx: [], normal: [] }; into.set(key, g); }

  if (f.dispinfo >= 0) {
    const built = buildDisplacement(dispInfos[f.dispinfo], poly, dispVerts);
    if (!built) { skipped.disp++; continue; }
    const n = emitDisplacement(g, f, ti, texdata[ti.texdata], lmRects[fi], built, tf, dtf);
    if (inSky) skyDispFaces++; else { dispFaces++; dispTris += n; }
    continue;
  }

  const pl = planes[f.planenum];
  const nrm = f.side ? [-pl.n[0], -pl.n[1], -pl.n[2]] : pl.n;
  const [nx, ny, nz] = dtf(nrm[0], nrm[1], nrm[2]);
  const nl = Math.hypot(nx, ny, nz) || 1;

  const td = texdata[ti.texdata];
  const rect = lmRects[fi];
  const base = g.pos.length / 3;
  for (const p of poly) {
    const [x, y, z] = tf(p[0], p[1], p[2]);
    g.pos.push(x, y, z);
    g.normal.push(nx / nl, ny / nl, nz / nl);
    const tv = ti.textureVecs;
    g.uv.push(
      (p[0] * tv[0][0] + p[1] * tv[0][1] + p[2] * tv[0][2] + tv[0][3]) / td.width,
      // three.js UV origin is bottom-left; Source's is top-left
      1 - (p[0] * tv[1][0] + p[1] * tv[1][1] + p[2] * tv[1][2] + tv[1][3]) / td.height,
    );
    if (rect) {
      const lv = ti.lightmapVecs;
      const lu = (p[0] * lv[0][0] + p[1] * lv[0][1] + p[2] * lv[0][2] + lv[0][3]) - f.lmMins[0];
      const lvv = (p[0] * lv[1][0] + p[1] * lv[1][1] + p[2] * lv[1][2] + lv[1][3]) - f.lmMins[1];
      g.uv2.push(
        (rect.x + Math.max(0, Math.min(rect.w, lu))) / atlasW,
        1 - (rect.y + Math.max(0, Math.min(rect.h, lvv))) / atlasH,
      );
    } else {
      g.uv2.push(0.5 / atlasW, 1 - 0.5 / atlasH); // unlit faces sample a white-ish corner
    }
  }
  // fan-triangulate; Source faces are convex and wound clockwise from outside
  for (let i = 1; i < poly.length - 1; i++) g.idx.push(base, base + i + 1, base + i);
}

// ------------------------------------------------------- the 3D skybox payload
// Painter's order, decided here rather than by a depth buffer at run time: the group is
// always centred on the viewer, so "far from the anchor" is far from the eye whichever way
// the camera looks, and a static back-to-front sort is right from every angle.
let skyRadius = 0, skyTris = 0;
const SKY_DP = 3;   // decimals the payload keeps; sort on THOSE, or the file comes out unsorted
for (const g of skyGroups.values()) {
  for (let i = 0; i < g.pos.length; i++) g.pos[i] = +g.pos[i].toFixed(SKY_DP);
  const tri = [];
  for (let t = 0; t < g.idx.length; t += 3) {
    let far = 0;
    for (const v of [g.idx[t], g.idx[t + 1], g.idx[t + 2]])
      far = Math.max(far, Math.hypot(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]));
    tri.push([far, g.idx[t], g.idx[t + 1], g.idx[t + 2]]);
    skyRadius = Math.max(skyRadius, far);
  }
  tri.sort((a, b) => b[0] - a[0]);
  g.idx = tri.flatMap(([, a, b, c]) => [a, b, c]);
  skyTris += tri.length;
}

// ---------------------------------------------------------------- brushes
const brushes = bsp.brushes().filter((b) => !b.degenerate).map((b) => ({
  contents: b.contents,
  solid: !!(b.contents & CONTENTS.SOLID),
  clip: !!(b.contents & (CONTENTS.PLAYERCLIP | CONTENTS.MONSTERCLIP)),
  water: !!(b.contents & CONTENTS.WATER),
  detail: !!(b.contents & CONTENTS.DETAIL),
  axisAligned: b.axisAligned,
  min: toThree(b.mins[0], b.mins[1], b.mins[2]),
  max: toThree(b.maxs[0], b.maxs[1], b.maxs[2]),
}));
// toThree negates Y, so min/max need re-sorting per axis
for (const b of brushes) for (let a = 0; a < 3; a++)
  if (b.min[a] > b.max[a]) { const t = b.min[a]; b.min[a] = b.max[a]; b.max[a] = t; }

// ---------------------------------------------------------------- entities
const num = (s, d = 0) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };
const originOf = (e) => { const p = (e.origin ?? '0 0 0').split(/\s+/).map(Number); return toThree(p[0] || 0, p[1] || 0, p[2] || 0); };
const entities = ents.map((e, i) => ({
  index: i, classname: e.classname ?? '', targetname: e.targetname,
  origin: e.origin ? originOf(e) : null,
  // Source yaw is counter-clockwise about Z from +X; three.js yaw is about +Y
  angles: e.angles ? e.angles.split(/\s+/).map(Number) : null,
  model: e.model ?? null,
  keys: e,
}));

const out = {
  map: mapName,
  generator: 'tools/bsp/extract.mjs',
  bspVersion: bsp.version,
  unitsToMeters: UNITS_TO_M,
  playfieldShift: SHIFT,
  lightmap: { file: 'lightmap.png', width: atlasW, height: atlasH, brightness: LM_BRIGHTNESS },
  displacements: { faces: dispFaces, tris: dispTris },
  // the 3D skybox: vertices are RELATIVE to the sky camera and already scaled, so a renderer
  // parents this to the camera and draws it first with no depth (see docs/TECH.md)
  sky: SKY_ORIGIN ? {
    scale: SKY_SCALE,
    radius: +skyRadius.toFixed(2),
    faces: skyFaces,
    displacements: skyDispFaces,
    groups: [...skyGroups.values()].map((g) => ({
      model: g.model, material: g.material,
      pos: g.pos,   // already rounded above, so the back-to-front order in `idx` is exact
      normal: g.normal.map((v) => +v.toFixed(3)),
      uv: g.uv.map((v) => +v.toFixed(5)),
      uv2: g.uv2.map((v) => +v.toFixed(6)),
      idx: g.idx,
    })),
  } : null,
  materials: [...materials.values()].map((m) => ({
    name: m.name, file: m.file, width: m.width, height: m.height,
    transparent: m.transparent, tool: m.tool, stock: m.stock, missing: m.missing,
    generated: m.generated, kind: m.kind, note: m.note ?? null, shader: m.shader,
  })),
  models: models.map((m) => ({ mins: m.mins, maxs: m.maxs, origin: m.origin })),
  groups: [...groups.values()].map((g) => ({
    model: g.model, material: g.material,
    pos: g.pos.map((v) => +v.toFixed(4)),
    normal: g.normal.map((v) => +v.toFixed(3)),
    uv: g.uv.map((v) => +v.toFixed(5)),
    uv2: g.uv2.map((v) => +v.toFixed(6)),
    idx: g.idx,
  })),
  brushes,
  entities,
};
writeFileSync(join(outDir, 'scene.json'), JSON.stringify(out));

const tris = out.groups.reduce((n, g) => n + g.idx.length / 3, 0);
const bounds = [0, 1, 2].map((a) => {
  let lo = Infinity, hi = -Infinity;
  for (const g of out.groups) for (let i = a; i < g.pos.length; i += 3) { lo = Math.min(lo, g.pos[i]); hi = Math.max(hi, g.pos[i]); }
  return [lo, hi];
});
console.log(`${mapName}: ${faces.length} faces -> ${tris} tris in ${out.groups.length} groups`);
console.log(`  materials: ${materials.size} (${[...materials.values()].filter((m) => m.tool).length} tool, ${[...materials.values()].filter((m) => m.missing).length} missing, ${[...materials.values()].filter((m) => m.stock && !m.tool).length} stock Valve)`);
console.log(`  lightmap atlas: ${atlasW}x${atlasH}  (${order.length}/${faces.length} faces lit)`);
console.log(`  brushes: ${brushes.length}  entities: ${entities.length}`);
console.log(`  displacements: ${dispFaces} faces -> ${dispTris} tris`);
if (out.sky) console.log(`  3D skybox: ${skyFaces} faces (${skyDispFaces} displacements) -> ${skyTris} tris in ${out.sky.groups.length} groups, scale ${SKY_SCALE}, radius ${skyRadius.toFixed(0)} m`);
console.log(`  skipped: ${JSON.stringify(skipped)}`);
console.log(`  bounds (m): ` + bounds.map(([lo, hi], i) => `${'xyz'[i]} ${lo.toFixed(1)}..${hi.toFixed(1)} (${(hi - lo).toFixed(1)})`).join('  '));
