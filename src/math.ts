// The shared deterministic math module (TECH §3). Everything here uses ONLY operations
// the ECMAScript spec pins to exact IEEE-754 results (+ - * /, sqrt, floor, abs, min,
// max, imul, shifts), so the same inputs produce bit-identical outputs on every
// machine — the property lockstep co-op and replay determinism stand on. Sim code may
// never call Math.sin/cos/pow/... (lint-enforced: scripts/check-sim-math.mjs); it
// calls dSin/dCos here instead.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/**
 * Deterministic sine, ~0.001 absolute error: exact range reduction to [-π, π], then the
 * classic parabola approximation refined once. Every step is spec-exact arithmetic, so
 * all platforms agree to the last bit. Plenty for steering/arc math; nothing in the sim
 * needs libm-grade precision.
 */
export function dSin(x: number): number {
  x -= TWO_PI * Math.floor((x + PI) / TWO_PI);
  const B = 4 / PI;
  const C = -4 / (PI * PI);
  const y = B * x + C * x * Math.abs(x);
  return 0.225 * (y * Math.abs(y) - y) + y;
}

/** Deterministic cosine via the sine identity. */
export function dCos(x: number): number {
  return dSin(x + HALF_PI);
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32. Integer ops + one exact power-of-two division, so it is
// deterministic cross-platform. One stream PER SUBSYSTEM (TECH §3): a divergent draw
// in one subsystem must not cascade into all the others, and per-player loot streams
// (M10 co-op) need loot isolated from combat rolls from day one.
// ---------------------------------------------------------------------------

export interface Prng {
  state: number; // exposed so the state hash can capture it and replays can restore it
  next(): number; // uniform in [0, 1)
  range(min: number, max: number): number; // uniform float in [min, max)
  int(min: number, max: number): number; // uniform integer in [min, max] inclusive
  chance(p: number): boolean;
}

export function makePrng(seed: number): Prng {
  const rng: Prng = {
    state: seed | 0,
    next() {
      rng.state = (rng.state + 0x6d2b79f5) | 0;
      let t = rng.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * rng.next();
    },
    int(min, max) {
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    chance(p) {
      return rng.next() < p;
    },
  };
  return rng;
}

/** Derive a subsystem stream seed from the run seed: distinct golden-ratio offsets,
 *  avalanched, so streams are decorrelated even for adjacent run seeds. */
export function deriveSeed(runSeed: number, streamIndex: number): number {
  let h = (runSeed ^ Math.imul(streamIndex + 1, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

// ---------------------------------------------------------------------------
// State hashing (TECH §3): FNV-1a over raw bit patterns. Hash the sim every
// HASH_INTERVAL ticks; two machines running the same command stream must print the
// same hex forever. Divergence is then detectable long before netcode exists.
// ---------------------------------------------------------------------------

export function hashInit(): number {
  return 0x811c9dc5 | 0;
}

export function hashU32(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  h = Math.imul(h ^ (v >>> 24), 0x01000193);
  return h | 0;
}

const f64Scratch = new Float64Array(1);
const u32OfF64 = new Uint32Array(f64Scratch.buffer);

/** Hash a double's exact bit pattern (both words), not a rounded value. */
export function hashF64(h: number, v: number): number {
  f64Scratch[0] = v;
  h = hashU32(h, u32OfF64[0]);
  return hashU32(h, u32OfF64[1]);
}

/** Hash the first `count` elements of a Float32Array by bit pattern. The array's
 *  buffer must start at offset 0 (all sim arrays do — they're standalone). */
export function hashF32Array(h: number, arr: Float32Array, count: number): number {
  const u32 = new Uint32Array(arr.buffer, 0, count);
  for (let i = 0; i < count; i++) h = hashU32(h, u32[i]);
  return h;
}

/** Render a hash as the 8-hex-char tag the HUD shows. */
export function hashHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
