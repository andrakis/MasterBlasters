// Stand-ins for materials we deliberately do not ship.
//
// Ranked by honesty:
//   1. a CC0 texture, when one genuinely exists (public/textures/cc0/)
//   2. a generated texture, when the original is not really a texture at all
//   3. the loud magenta placeholder (lib/placeholder.mjs) — everything else
//
// Water lands in (2) on purpose: neither ambientCG nor Poly Haven ships a water
// albedo, because water in an engine is a shader — refraction, a normal map and a
// tint — not a diffuse image. Generating a ripple pattern is more honest than
// dressing up an "ice" or "puddle" photo as water.

/** Seamless because every frequency is an integer number of cycles per tile. */
export function waterTexture(size = 256, opts = {}) {
  const { shallow = [46, 100, 108], deep = [16, 40, 52], foam = [120, 168, 176] } = opts;
  const px = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  // Many low-amplitude trains at mixed angles rather than a few strong ones: the
  // source UVs tile this dozens of times across a big water plane, and a sharp
  // directional ripple aliases into hard stripes at that density.
  const waves = [
    [1, 2, 0.0, 0.34], [2, -1, 1.7, 0.30], [3, 3, 0.4, 0.20],
    [-2, 4, 2.9, 0.16], [5, 1, 1.1, 0.12], [1, -6, 0.7, 0.09],
    [7, 3, 2.2, 0.06], [-4, -5, 0.3, 0.05],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = 0, amp = 0;
      for (const [fu, fv, ph, a] of waves) { h += Math.sin(TAU * (fu * u + fv * v) + ph) * a; amp += a; }
      const t = h / amp * 0.5 + 0.5;
      // gentle crest lift only — enough to read as water, not enough to moire
      const crest = Math.pow(Math.max(0, t), 4);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = deep[c] + (shallow[c] - deep[c]) * t;
        px[i + c] = Math.max(0, Math.min(255, base + (foam[c] - base) * crest * 0.35)) | 0;
      }
      px[i + 3] = 255;
    }
  }
  return { width: size, height: size, pixels: px };
}

/**
 * Which stand-in to use for a material we could not resolve. `cc0` entries point
 * at a repo-absolute path so one file serves every map.
 */
const RULES = [
  { test: /^props[\/\\]woodcrate/i, kind: 'cc0', file: '/textures/cc0/crate.png',
    note: 'ambientCG Planks021 (CC0 1.0)' },
  { test: /^nature[\/\\]blend|rockgravel|^nature[\/\\]rock/i, kind: 'cc0',
    file: '/textures/cc0/rockgravel.png',
    note: 'ambientCG Ground079S (CC0 1.0) — stands in for a WorldVertexTransition blend, single layer' },
  { test: /water/i, kind: 'generated', generate: () => waterTexture(256),
    note: 'generated ripple pattern — no CC0 water albedo exists; water is a shader' },
];

export function findSubstitute(name) {
  return RULES.find((r) => r.test.test(name)) ?? null;
}
