#!/usr/bin/env node
// Extract a Source model (MDL+VVD+VTX) into three.js-ready JSON + PNG textures.
//
//   node tools/mdl/extract.mjs <model.mdl> --materials <dir> --out <dir> [--name id]
//
// Bind pose only — see tools/lib/mdl.mjs for why that is sufficient here.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readMdl, readVvd, readVtx, findVtx, findVvd } from '../lib/mdl.mjs';
import { readVtf } from '../lib/vtf.mjs';
import { findMaterial } from '../lib/vmt.mjs';
import { encodePng } from '../lib/png.mjs';
import { missingTexture } from '../lib/placeholder.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const mdlPath = argv[0];
const materialsRoot = flag('--materials', '/home/code/git/masterblasters_hl2/materials');
const outDir = flag('--out', null);
const id = flag('--name', mdlPath ? basename(mdlPath, '.mdl').toLowerCase() : null);
// Source models are in inches like the maps, so the same scale applies.
const SCALE = Number(flag('--scale', 0.0254));
if (!mdlPath || !outDir) {
  console.error('usage: extract.mjs <model.mdl> --materials <dir> --out <dir> [--name id]');
  process.exit(1);
}

const vtxPath = findVtx(mdlPath);
const vvdPath = findVvd(mdlPath);
// Some entries in the mod tree are .mdl-only stubs (w_crowbar has no vvd/vtx at
// all) — they carry no geometry of their own and cannot be extracted.
if (!vtxPath || !vvdPath) {
  console.error(`${basename(mdlPath)}: no ${!vtxPath ? '.vtx' : '.vvd'} alongside — stub model, skipping`);
  process.exit(2);
}

const mdl = readMdl(mdlPath);
const vvd = readVvd(vvdPath);
const vtx = readVtx(vtxPath);

mkdirSync(join(outDir, 'textures'), { recursive: true });

// ------------------------------------------------------------- materials
// An MDL names a material and separately lists search paths; the real VMT is
// <searchPath><materialName>.vmt for whichever path hits first.
const matOut = [];
for (const [i, name] of mdl.materials.entries()) {
  const rec = { index: i, name, file: null, width: 128, height: 128, transparent: false, missing: false, shader: null, resolvedFrom: null };
  for (const sp of mdl.searchPaths.length ? mdl.searchPaths : ['']) {
    const rel = (sp.replace(/\\/g, '/').replace(/^materials\//i, '') + name).replace(/\/+/g, '/');
    const found = findMaterial(materialsRoot, rel);
    if (found?.vtfPath) {
      try {
        const tex = readVtf(found.vtfPath);
        rec.shader = found.shader;
        rec.width = tex.width; rec.height = tex.height;
        rec.transparent = hasAlpha(tex.pixels);
        rec.resolvedFrom = rel;
        const file = `${id}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
        writeFileSync(join(outDir, 'textures', file), encodePng(tex.pixels, tex.width, tex.height));
        rec.file = `textures/${file}`;
      } catch (e) { console.warn(`  ! ${name}: ${e.message}`); }
      break;
    }
  }
  if (!rec.file) {
    rec.missing = true;
    const tex = missingTexture();
    const file = `${id}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
    writeFileSync(join(outDir, 'textures', file), encodePng(tex.pixels, tex.width, tex.height));
    rec.file = `textures/${file}`;
  }
  matOut.push(rec);
}
function hasAlpha(px) { for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true; return false; }

// ------------------------------------------------------------- geometry
// Source is Z-up / X-forward; three.js is Y-up.
const toThree = (x, y, z) => [x * SCALE, z * SCALE, -y * SCALE];

const groups = new Map(); // material index -> buffers
let totalTris = 0, dropped = 0;

for (const [bpi, bp] of mdl.bodyparts.entries()) {
  const vbp = vtx.bodyparts[bpi];
  if (!vbp) continue;
  for (const [mi, model] of bp.models.entries()) {
    const vmodel = vbp.models[mi];
    if (!vmodel) continue;
    for (const [mei, mesh] of model.meshes.entries()) {
      const vmesh = vmodel.meshes[mei];
      if (!vmesh || !vmesh.indices.length) continue;
      // skin family 0 remaps the mesh's material slot
      const matIdx = mdl.skins[0]?.[mesh.material] ?? mesh.material;
      let g = groups.get(matIdx);
      if (!g) { g = { material: matIdx, pos: [], normal: [], uv: [], idx: [], map: new Map() }; groups.set(matIdx, g); }

      for (let i = 0; i < vmesh.indices.length; i += 3) {
        const tri = [];
        let ok = true;
        for (let k = 0; k < 3; k++) {
          // VTX gives an index within the mesh; add the model's and mesh's
          // vertex offsets to reach the VVD array
          const vvdIndex = model.vertexoffset + mesh.vertexoffset + vmesh.indices[i + k];
          const v = vvd.verts[vvdIndex];
          if (!v) { ok = false; break; }
          let local = g.map.get(vvdIndex);
          if (local === undefined) {
            local = g.pos.length / 3;
            g.map.set(vvdIndex, local);
            const [px, py, pz] = toThree(v.px, v.py, v.pz);
            const [nx, ny, nz] = toThree(v.nx, v.ny, v.nz);
            g.pos.push(px, py, pz);
            g.normal.push(nx, ny, nz);
            g.uv.push(v.u, 1 - v.v); // three.js UV origin is bottom-left
          }
          tri.push(local);
        }
        if (!ok) { dropped++; continue; }
        // negating Y flips handedness, so reverse the winding to keep normals out
        g.idx.push(tri[0], tri[2], tri[1]);
        totalTris++;
      }
    }
  }
}

const bounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
for (const g of groups.values()) for (let i = 0; i < g.pos.length; i += 3)
  for (let a = 0; a < 3; a++) { bounds[a][0] = Math.min(bounds[a][0], g.pos[i + a]); bounds[a][1] = Math.max(bounds[a][1], g.pos[i + a]); }

const out = {
  id,
  generator: 'tools/mdl/extract.mjs',
  source: basename(mdlPath),
  internalName: mdl.name,
  mdlVersion: mdl.version,
  scale: SCALE,
  bindPoseOnly: true,
  searchPaths: mdl.searchPaths,
  materials: matOut,
  bounds,
  groups: [...groups.values()].map((g) => ({
    material: g.material,
    pos: g.pos.map((v) => +v.toFixed(5)),
    normal: g.normal.map((v) => +v.toFixed(4)),
    uv: g.uv.map((v) => +v.toFixed(5)),
    idx: g.idx,
  })),
};
writeFileSync(join(outDir, `${id}.json`), JSON.stringify(out));

console.log(`${id}: ${totalTris} tris in ${groups.size} groups  (mdl "${mdl.name}" v${mdl.version})`);
console.log(`  vvd verts ${vvd.verts.length} (fixups ${vvd.numFixups})  vtx v${vtx.version}  ${basename(vtxPath)}`);
console.log(`  materials: ${matOut.map((m) => m.name + (m.missing ? '(MISSING)' : '')).join(', ')}`);
console.log(`  search paths: ${mdl.searchPaths.join(' ') || '(none)'}`);
console.log(`  size (m): ` + bounds.map(([lo, hi], i) => `${'xyz'[i]} ${(hi - lo).toFixed(2)}`).join('  '));
if (dropped) console.log(`  dropped ${dropped} tris with out-of-range vertices`);
