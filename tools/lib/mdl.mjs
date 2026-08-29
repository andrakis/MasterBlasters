// Source engine model reader: MDL + VVD + VTX.
//
// Three interlocking files, and you need all three:
//   .mdl  structure — bodyparts/models/meshes, material names, search paths
//   .vvd  vertex data — position, normal, UV, bone weights, in BIND POSE
//   .vtx  the actual index buffer, per LOD, as strip groups
//
// We read the bind pose only. That is not a limitation for our use: the VVD
// stores vertices already posed, so a static mesh needs no bone matrices at all.
// Animation would need the bone tree and the anim lumps; we rebuild motion in
// our own sim instead.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/** Model trees mix case freely (male_01.mdl next to Male_01.dx90.vtx). */
function findInsensitive(dir, wanted) {
  try {
    const hit = readdirSync(dir).find((e) => e.toLowerCase() === wanted.toLowerCase());
    return hit ? join(dir, hit) : null;
  } catch { return null; }
}

const cstr = (buf, o) => {
  let e = o;
  while (e < buf.length && buf[e] !== 0) e++;
  return buf.toString('latin1', o, e);
};

// ---------------------------------------------------------------------- MDL
export function readMdl(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'IDST') throw new Error(`${path}: not an MDL (IDST)`);
  const version = b.readInt32LE(4);
  const name = cstr(b, 12);

  const numtextures = b.readInt32LE(204), textureindex = b.readInt32LE(208);
  const numcdtextures = b.readInt32LE(212), cdtextureindex = b.readInt32LE(216);
  const numskinref = b.readInt32LE(220), numskinfamilies = b.readInt32LE(224), skinindex = b.readInt32LE(228);
  const numbodyparts = b.readInt32LE(232), bodypartindex = b.readInt32LE(236);

  // mstudiotexture_t is 64 bytes; sznameindex is relative to the struct start
  const materials = [];
  for (let i = 0; i < numtextures; i++) {
    const base = textureindex + i * 64;
    materials.push(cstr(b, base + b.readInt32LE(base)));
  }
  const searchPaths = [];
  for (let i = 0; i < numcdtextures; i++) searchPaths.push(cstr(b, b.readInt32LE(cdtextureindex + i * 4)));

  // skin families remap mesh material indices; family 0 is the default
  const skins = [];
  for (let f = 0; f < numskinfamilies; f++) {
    const row = [];
    for (let r = 0; r < numskinref; r++) row.push(b.readInt16LE(skinindex + (f * numskinref + r) * 2));
    skins.push(row);
  }

  const bodyparts = [];
  for (let bp = 0; bp < numbodyparts; bp++) {
    const bpBase = bodypartindex + bp * 16;
    const bpName = cstr(b, bpBase + b.readInt32LE(bpBase));
    const nummodels = b.readInt32LE(bpBase + 4);
    const modelindex = b.readInt32LE(bpBase + 12);
    const models = [];
    for (let m = 0; m < nummodels; m++) {
      // mstudiomodel_t is 148 bytes, offsets relative to the struct
      const mBase = bpBase + modelindex + m * 148;
      const mName = cstr(b, mBase);
      const nummeshes = b.readInt32LE(mBase + 72), meshindex = b.readInt32LE(mBase + 76);
      const numvertices = b.readInt32LE(mBase + 80), vertexindex = b.readInt32LE(mBase + 84);
      const meshes = [];
      for (let me = 0; me < nummeshes; me++) {
        // mstudiomesh_t is 116 bytes
        const eBase = mBase + meshindex + me * 116;
        meshes.push({
          material: b.readInt32LE(eBase),
          numvertices: b.readInt32LE(eBase + 8),
          vertexoffset: b.readInt32LE(eBase + 12),
        });
      }
      // vertexindex is a BYTE offset into the vvd vertex array for this model
      models.push({ name: mName, numvertices, vertexoffset: vertexindex / 48, meshes });
    }
    bodyparts.push({ name: bpName, models });
  }

  return { path, version, name, materials, searchPaths, skins, bodyparts };
}

// ---------------------------------------------------------------------- VVD
export function readVvd(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'IDSV') throw new Error(`${path}: not a VVD (IDSV)`);
  const version = b.readInt32LE(4);
  const numLods = b.readInt32LE(12);
  const lodVertexCount = [];
  for (let i = 0; i < 8; i++) lodVertexCount.push(b.readInt32LE(16 + i * 4));
  const numFixups = b.readInt32LE(48), fixupIndex = b.readInt32LE(52);
  const vertexDataStart = b.readInt32LE(56);

  const total = lodVertexCount[0];
  const readVert = (i) => {
    const o = vertexDataStart + i * 48;
    return {
      // skip the 16-byte bone weight block; we render the bind pose
      px: b.readFloatLE(o + 16), py: b.readFloatLE(o + 20), pz: b.readFloatLE(o + 24),
      nx: b.readFloatLE(o + 28), ny: b.readFloatLE(o + 32), nz: b.readFloatLE(o + 36),
      u: b.readFloatLE(o + 40), v: b.readFloatLE(o + 44),
    };
  };

  // Fixups reorder vertices per LOD. With none, the array is already in order.
  let verts;
  if (numFixups > 0) {
    verts = [];
    for (let f = 0; f < numFixups; f++) {
      const o = fixupIndex + f * 12;
      const lod = b.readInt32LE(o), src = b.readInt32LE(o + 4), n = b.readInt32LE(o + 8);
      if (lod < 0) continue;
      for (let i = 0; i < n; i++) verts.push(readVert(src + i));
    }
  } else {
    verts = [];
    for (let i = 0; i < total; i++) verts.push(readVert(i));
  }
  return { version, numLods, numFixups, verts };
}

// ---------------------------------------------------------------------- VTX
/** The index buffer. Returns LOD 0 as [bodypart][model][mesh] -> {indices, vtxVerts}. */
export function readVtx(path) {
  const b = readFileSync(path);
  const version = b.readInt32LE(0);
  const numLODs = b.readInt32LE(20);
  const numBodyParts = b.readInt32LE(28), bodyPartOffset = b.readInt32LE(32);

  const bodyparts = [];
  for (let bp = 0; bp < numBodyParts; bp++) {
    const bpBase = bodyPartOffset + bp * 8;
    const numModels = b.readInt32LE(bpBase), modelOffset = b.readInt32LE(bpBase + 4);
    const models = [];
    for (let m = 0; m < numModels; m++) {
      const mBase = bpBase + modelOffset + m * 8;
      const numLod = b.readInt32LE(mBase), lodOffset = b.readInt32LE(mBase + 4);
      // LOD 0 only — the highest detail
      const lodBase = mBase + lodOffset;
      const numMeshes = b.readInt32LE(lodBase), meshOffset = b.readInt32LE(lodBase + 4);
      const meshes = [];
      for (let me = 0; me < numMeshes; me++) {
        const eBase = lodBase + meshOffset + me * 9;
        const numStripGroups = b.readInt32LE(eBase), stripGroupOffset = b.readInt32LE(eBase + 4);
        const indices = [];
        for (let sg = 0; sg < numStripGroups; sg++) {
          const gBase = eBase + stripGroupOffset + sg * 25;
          const numVerts = b.readInt32LE(gBase), vertOffset = b.readInt32LE(gBase + 4);
          const numIndices = b.readInt32LE(gBase + 8), indexOffset = b.readInt32LE(gBase + 12);
          const numStrips = b.readInt32LE(gBase + 16), stripOffset = b.readInt32LE(gBase + 20);
          // Vertex_t is 9 bytes; origMeshVertID at +4 maps into the mesh's
          // vertex range, which in turn indexes the VVD array
          const map = new Uint16Array(numVerts);
          for (let v = 0; v < numVerts; v++) map[v] = b.readUInt16LE(gBase + vertOffset + v * 9 + 4);
          for (let st = 0; st < numStrips; st++) {
            const sBase = gBase + stripOffset + st * 27;
            const sNumIndices = b.readInt32LE(sBase), sIndexOffset = b.readInt32LE(sBase + 4);
            const flags = b[sBase + 22];
            const base = gBase + indexOffset;
            if (flags & 0x02) {
              // STRIP_TRISTRIP — convert to a list, flipping alternate winding
              for (let i = 0; i < sNumIndices - 2; i++) {
                const a = map[b.readUInt16LE(base + (sIndexOffset + i) * 2)];
                const c = map[b.readUInt16LE(base + (sIndexOffset + i + 1) * 2)];
                const d = map[b.readUInt16LE(base + (sIndexOffset + i + 2) * 2)];
                if (a === c || c === d || a === d) continue; // degenerate joiner
                if (i & 1) indices.push(a, d, c); else indices.push(a, c, d);
              }
            } else {
              for (let i = 0; i < sNumIndices; i += 3) {
                indices.push(
                  map[b.readUInt16LE(base + (sIndexOffset + i) * 2)],
                  map[b.readUInt16LE(base + (sIndexOffset + i + 1) * 2)],
                  map[b.readUInt16LE(base + (sIndexOffset + i + 2) * 2)],
                );
              }
            }
          }
        }
        meshes.push({ indices });
      }
      models.push({ meshes });
    }
    bodyparts.push({ models });
  }
  return { version, numLODs, bodyparts };
}

/** Pick whichever .vtx flavour shipped. dx90 is the highest quality. */
export function findVtx(mdlPath) {
  const dir = dirname(mdlPath);
  const stem = basename(mdlPath).replace(/\.mdl$/i, '');
  for (const suf of ['.dx90.vtx', '.dx80.vtx', '.sw.vtx', '.vtx']) {
    const hit = findInsensitive(dir, stem + suf);
    if (hit) return hit;
  }
  return null;
}

/** The .vvd beside an .mdl, tolerating a case mismatch. */
export function findVvd(mdlPath) {
  const dir = dirname(mdlPath);
  const stem = basename(mdlPath).replace(/\.mdl$/i, '');
  return findInsensitive(dir, stem + '.vvd');
}
