// Reader for VBSP (Source engine) map files, version 19-21.
//
// Only the lumps the asset pipeline needs are decoded. Two geometry views are
// exposed and they are NOT interchangeable:
//   brushes() -> the original convex volumes the level designer placed. Coarse,
//                but this is what maps onto our box-based MapDef.
//   faces()   -> the compiled render surfaces, with texture and lightmap UVs.
//                This is the fidelity path used by the viewer.
import { readFileSync } from 'node:fs';

export const LUMP = {
  ENTITIES: 0, PLANES: 1, TEXDATA: 2, VERTEXES: 3, TEXINFO: 6, FACES: 7,
  LIGHTING: 8, EDGES: 12, SURFEDGES: 13, MODELS: 14, BRUSHES: 18,
  BRUSHSIDES: 19, TEXDATA_STRING_DATA: 43, TEXDATA_STRING_TABLE: 44,
};

// contents flags we care about (public/bspflags.h)
export const CONTENTS = {
  SOLID: 0x1, WINDOW: 0x2, GRATE: 0x8, WATER: 0x20, OPAQUE: 0x80,
  PLAYERCLIP: 0x10000, MONSTERCLIP: 0x20000, DETAIL: 0x8000000,
  TRANSLUCENT: 0x10000000,
};

// texinfo flags (surface properties)
export const SURF = {
  LIGHT: 0x1, SKY2D: 0x2, SKY: 0x4, WARP: 0x8, TRANS: 0x10, NOPORTAL: 0x20,
  TRIGGER: 0x40, NODRAW: 0x80, HINT: 0x100, SKIP: 0x200, NOLIGHT: 0x400,
};

export class Bsp {
  constructor(path) {
    this.buf = readFileSync(path);
    const b = this.buf;
    if (b.toString('ascii', 0, 4) !== 'VBSP') throw new Error(`${path}: not a VBSP file`);
    this.version = b.readInt32LE(4);
    this.lumps = [];
    for (let i = 0; i < 64; i++) {
      const o = 8 + i * 16;
      this.lumps.push({ ofs: b.readInt32LE(o), len: b.readInt32LE(o + 4), ver: b.readInt32LE(o + 8) });
    }
    this._cache = new Map();
  }

  lump(i) { return this.lumps[i]; }

  // memoised so repeated accessor calls stay cheap
  _once(key, fn) {
    if (!this._cache.has(key)) this._cache.set(key, fn());
    return this._cache.get(key);
  }

  /** Entity lump: array of flat key/value objects, in file order. */
  entities() {
    return this._once('ents', () => {
      const { ofs, len } = this.lump(LUMP.ENTITIES);
      const text = this.buf.toString('latin1', ofs, ofs + len);
      const out = [];
      for (const m of text.matchAll(/\{([^}]*)\}/g)) {
        const kv = {};
        // connections (entity I/O) repeat keys; keep them in a side array
        for (const p of m[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)) {
          if (kv[p[1]] === undefined) kv[p[1]] = p[2];
          else (kv.__dup ??= []).push([p[1], p[2]]);
        }
        out.push(kv);
      }
      return out;
    });
  }

  planes() {
    return this._once('planes', () => {
      const { ofs, len } = this.lump(LUMP.PLANES), b = this.buf, out = [];
      for (let i = 0; i < len / 20; i++) {
        const o = ofs + i * 20;
        out.push({ n: [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)], d: b.readFloatLE(o + 12) });
      }
      return out;
    });
  }

  /** Material name table, indexed by texdata index. */
  texdata() {
    return this._once('texdata', () => {
      const b = this.buf;
      const tst = this.lump(LUMP.TEXDATA_STRING_TABLE), tsd = this.lump(LUMP.TEXDATA_STRING_DATA);
      const offs = [];
      for (let i = 0; i < tst.len / 4; i++) offs.push(b.readInt32LE(tst.ofs + i * 4));
      const str = (i) => {
        let s = tsd.ofs + offs[i], e = s;
        while (b[e] !== 0) e++;
        return b.toString('ascii', s, e);
      };
      const { ofs, len } = this.lump(LUMP.TEXDATA), out = [];
      for (let i = 0; i < len / 32; i++) {
        const o = ofs + i * 32;
        out.push({
          reflectivity: [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)],
          name: str(b.readInt32LE(o + 12)),
          width: b.readInt32LE(o + 16), height: b.readInt32LE(o + 20),
        });
      }
      return out;
    });
  }

  texinfo() {
    return this._once('texinfo', () => {
      const { ofs, len } = this.lump(LUMP.TEXINFO), b = this.buf, out = [];
      for (let i = 0; i < len / 72; i++) {
        const o = ofs + i * 72;
        const vec = (base) => [0, 1].map((r) =>
          [0, 1, 2, 3].map((c) => b.readFloatLE(base + r * 16 + c * 4)));
        out.push({
          textureVecs: vec(o), lightmapVecs: vec(o + 32),
          flags: b.readInt32LE(o + 64), texdata: b.readInt32LE(o + 68),
        });
      }
      return out;
    });
  }

  vertexes() {
    return this._once('verts', () => {
      const { ofs, len } = this.lump(LUMP.VERTEXES), b = this.buf;
      const out = new Float32Array((len / 12) * 3);
      for (let i = 0; i < len / 12; i++) {
        const o = ofs + i * 12;
        out[i * 3] = b.readFloatLE(o); out[i * 3 + 1] = b.readFloatLE(o + 4); out[i * 3 + 2] = b.readFloatLE(o + 8);
      }
      return out;
    });
  }

  edges() {
    return this._once('edges', () => {
      const { ofs, len } = this.lump(LUMP.EDGES), b = this.buf;
      const out = new Uint16Array(len / 2);
      for (let i = 0; i < len / 2; i++) out[i] = b.readUInt16LE(ofs + i * 2);
      return out;
    });
  }

  surfedges() {
    return this._once('surfedges', () => {
      const { ofs, len } = this.lump(LUMP.SURFEDGES), b = this.buf;
      const out = new Int32Array(len / 4);
      for (let i = 0; i < len / 4; i++) out[i] = b.readInt32LE(ofs + i * 4);
      return out;
    });
  }

  /** dface_t, 56 bytes in v20. */
  faces() {
    return this._once('faces', () => {
      const { ofs, len } = this.lump(LUMP.FACES), b = this.buf, out = [];
      for (let i = 0; i < len / 56; i++) {
        const o = ofs + i * 56;
        out.push({
          planenum: b.readUInt16LE(o), side: b[o + 2], onNode: b[o + 3],
          firstedge: b.readInt32LE(o + 4), numedges: b.readInt16LE(o + 8),
          texinfo: b.readInt16LE(o + 10), dispinfo: b.readInt16LE(o + 12),
          styles: [b[o + 16], b[o + 17], b[o + 18], b[o + 19]],
          lightofs: b.readInt32LE(o + 20), area: b.readFloatLE(o + 24),
          lmMins: [b.readInt32LE(o + 28), b.readInt32LE(o + 32)],
          lmSize: [b.readInt32LE(o + 36), b.readInt32LE(o + 40)],
        });
      }
      return out;
    });
  }

  /** dmodel_t: model 0 is the world, 1..N are the brush entities (`"model" "*N"`). */
  models() {
    return this._once('models', () => {
      const { ofs, len } = this.lump(LUMP.MODELS), b = this.buf, out = [];
      const v3 = (o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
      for (let i = 0; i < len / 48; i++) {
        const o = ofs + i * 48;
        out.push({
          mins: v3(o), maxs: v3(o + 12), origin: v3(o + 24),
          headnode: b.readInt32LE(o + 36), firstface: b.readInt32LE(o + 40), numfaces: b.readInt32LE(o + 44),
        });
      }
      return out;
    });
  }

  /**
   * Brushes as convex hulls. Bevel sides (added by vbsp for collision) are
   * dropped — they are not part of the designer's original volume.
   */
  brushes() {
    return this._once('brushes', () => {
      const b = this.buf, planes = this.planes(), texinfo = this.texinfo(), texdata = this.texdata();
      const br = this.lump(LUMP.BRUSHES), bs = this.lump(LUMP.BRUSHSIDES), out = [];
      for (let i = 0; i < br.len / 12; i++) {
        const o = br.ofs + i * 12;
        const firstside = b.readInt32LE(o), numsides = b.readInt32LE(o + 4), contents = b.readInt32LE(o + 8);
        const sides = [];
        for (let s = 0; s < numsides; s++) {
          const so = bs.ofs + (firstside + s) * 8;
          const bevel = b.readInt16LE(so + 6);
          if (bevel) continue;
          const ti = b.readInt16LE(so + 2);
          sides.push({
            plane: planes[b.readUInt16LE(so)],
            material: ti >= 0 && texinfo[ti] ? texdata[texinfo[ti].texdata]?.name ?? null : null,
            flags: ti >= 0 && texinfo[ti] ? texinfo[ti].flags : 0,
          });
        }
        out.push({ index: i, contents, sides, ...hullOf(sides.map((s) => s.plane)) });
      }
      return out;
    });
  }
}

/**
 * Vertices of the convex volume bounded by `planes` (n.p <= d), by intersecting
 * every plane triple and keeping points satisfying all planes. O(n^3) but brush
 * side counts are small (typically 6-12).
 */
export function hullOf(planes) {
  const V = [], N = planes.length, EPS = 0.02;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) {
    const [a, c, e] = [planes[i], planes[j], planes[k]];
    const cx = c.n[1] * e.n[2] - c.n[2] * e.n[1], cy = c.n[2] * e.n[0] - c.n[0] * e.n[2], cz = c.n[0] * e.n[1] - c.n[1] * e.n[0];
    const det = a.n[0] * cx + a.n[1] * cy + a.n[2] * cz;
    if (Math.abs(det) < 1e-6) continue;
    const bx = e.n[1] * a.n[2] - e.n[2] * a.n[1], by = e.n[2] * a.n[0] - e.n[0] * a.n[2], bz = e.n[0] * a.n[1] - e.n[1] * a.n[0];
    const ax = a.n[1] * c.n[2] - a.n[2] * c.n[1], ay = a.n[2] * c.n[0] - a.n[0] * c.n[2], az = a.n[0] * c.n[1] - a.n[1] * c.n[0];
    const p = [(a.d * cx + c.d * bx + e.d * ax) / det, (a.d * cy + c.d * by + e.d * ay) / det, (a.d * cz + c.d * bz + e.d * az) / det];
    let inside = true;
    for (const q of planes) if (q.n[0] * p[0] + q.n[1] * p[1] + q.n[2] * p[2] - q.d > EPS) { inside = false; break; }
    if (inside) V.push(p);
  }
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (const v of V) for (let a = 0; a < 3; a++) { mins[a] = Math.min(mins[a], v[a]); maxs[a] = Math.max(maxs[a], v[a]); }
  // "axis-aligned" means every bounding plane faces down an axis, so the hull is
  // exactly its own AABB and converts to a MapDef box without loss.
  const axisAligned = planes.length > 0 && planes.every((p) => p.n.filter((v) => Math.abs(v) > 1e-4).length === 1);
  return { verts: V, mins, maxs, axisAligned, degenerate: V.length < 4 };
}

// ------------------------------------------------------------- displacements
// A displacement is a subdivided, offset "skin" stretched over one quad face of
// a brush. Source stores the flat quad in the normal face lumps and the offsets
// separately, so a reader that ignores these lumps silently loses whole terrain
// surfaces (arches, dunes, cliffs) while everything still looks structurally
// fine — which is exactly what happened before this existed.
//
// Collision is unaffected: the brush behind the displacement still contributes
// its AABB to the MapDef, so this is purely a rendering gap being closed.

export const DISP_LUMP = { INFO: 26, VERTS: 33, TRIS: 48 };

/** ddispinfo_t — 176 bytes in VBSP v20. Only the leading fields are decoded. */
export function readDispInfos(bsp) {
  const { ofs, len } = bsp.lump(DISP_LUMP.INFO), b = bsp.buf, out = [];
  for (let i = 0; i < len / 176; i++) {
    const o = ofs + i * 176;
    out.push({
      startPosition: [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)],
      vertStart: b.readInt32LE(o + 12),
      triStart: b.readInt32LE(o + 16),
      power: b.readInt32LE(o + 20),
      contents: b.readInt32LE(o + 32),
      mapFace: b.readUInt16LE(o + 36),
    });
  }
  return out;
}

/** CDispVert — 20 bytes: a unit direction, a distance along it, and a blend alpha. */
export function readDispVerts(bsp) {
  const { ofs, len } = bsp.lump(DISP_LUMP.VERTS), b = bsp.buf;
  const n = len / 20;
  const vec = new Float32Array(n * 3), dist = new Float32Array(n), alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = ofs + i * 20;
    vec[i * 3] = b.readFloatLE(o); vec[i * 3 + 1] = b.readFloatLE(o + 4); vec[i * 3 + 2] = b.readFloatLE(o + 8);
    dist[i] = b.readFloatLE(o + 12);
    alpha[i] = b.readFloatLE(o + 16);
  }
  return { count: n, vec, dist, alpha };
}

/**
 * Build one displacement's grid in Source space.
 *
 * `poly` is the face's 4 corners. `startPosition` identifies which corner the
 * grid starts from — the face winding alone does not, so the corners must be
 * rotated to match or the surface comes out mirrored and discontinuous against
 * its neighbours.
 *
 * Returns flat grid positions plus a triangle list. Diagonals alternate by
 * (i+j) parity, which is what vbsp does; a fixed diagonal leaves visible
 * directional banding on curved surfaces.
 */
export function buildDisplacement(disp, poly, dispVerts) {
  if (poly.length !== 4) return null;
  const size = (1 << disp.power) + 1;

  // rotate corners so index 0 is the one nearest startPosition
  let first = 0, best = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = (poly[i][0] - disp.startPosition[0]) ** 2
      + (poly[i][1] - disp.startPosition[1]) ** 2
      + (poly[i][2] - disp.startPosition[2]) ** 2;
    if (d < best) { best = d; first = i; }
  }
  const c = [0, 1, 2, 3].map((k) => poly[(first + k) % 4]);

  const positions = new Float32Array(size * size * 3);
  for (let i = 0; i < size; i++) {
    const fi = i / (size - 1);
    for (let j = 0; j < size; j++) {
      const fj = j / (size - 1);
      const idx = i * size + j;
      const dv = disp.vertStart + idx;
      const d = dispVerts.dist[dv];
      for (let a = 0; a < 3; a++) {
        // bilinear across the quad: c0->c1 and c3->c2 along i, blended along j
        const p0 = c[0][a] + (c[1][a] - c[0][a]) * fi;
        const p1 = c[3][a] + (c[2][a] - c[3][a]) * fi;
        positions[idx * 3 + a] = p0 + (p1 - p0) * fj + dispVerts.vec[dv * 3 + a] * d;
      }
    }
  }

  const indices = [];
  for (let i = 0; i < size - 1; i++) {
    for (let j = 0; j < size - 1; j++) {
      const a = i * size + j, b2 = a + 1, cc = (i + 1) * size + j + 1, d = (i + 1) * size + j;
      if ((i + j) & 1) indices.push(a, b2, cc, a, cc, d);
      else indices.push(a, b2, d, b2, cc, d);
    }
  }
  return { size, positions, indices, alphaStart: disp.vertStart };
}
