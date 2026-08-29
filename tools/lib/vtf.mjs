// Valve Texture Format (VTF) decoder -> RGBA8888.
//
// Handles v7.1-7.5 headers and the formats the mod actually ships (DXT1, DXT5,
// plus the uncompressed variants for completeness). Only the largest mip of the
// first frame is decoded; the mip chain is skipped.
import { readFileSync } from 'node:fs';

export const IMAGE_FORMAT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4, I8: 5, IA88: 6,
  P8: 7, A8: 8, RGB888_BLUESCREEN: 9, BGR888_BLUESCREEN: 10, ARGB8888: 11,
  BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, BGR565: 17,
  BGRX5551: 18, BGRA4444: 19, DXT1_ONEBITALPHA: 20, BGRA5551: 21, UV88: 22,
};
const NAME = Object.fromEntries(Object.entries(IMAGE_FORMAT).map(([k, v]) => [v, k]));

/** Bytes occupied by one mip level of `w`x`h` in `fmt`. */
function levelSize(fmt, w, h) {
  switch (fmt) {
    case IMAGE_FORMAT.DXT1: case IMAGE_FORMAT.DXT1_ONEBITALPHA:
      return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 8;
    case IMAGE_FORMAT.DXT3: case IMAGE_FORMAT.DXT5:
      return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 16;
    default: return w * h * bppOf(fmt);
  }
}
function bppOf(fmt) {
  switch (fmt) {
    case IMAGE_FORMAT.RGBA8888: case IMAGE_FORMAT.ABGR8888: case IMAGE_FORMAT.ARGB8888:
    case IMAGE_FORMAT.BGRA8888: case IMAGE_FORMAT.BGRX8888: return 4;
    case IMAGE_FORMAT.RGB888: case IMAGE_FORMAT.BGR888: return 3;
    case IMAGE_FORMAT.RGB565: case IMAGE_FORMAT.BGR565: case IMAGE_FORMAT.IA88:
    case IMAGE_FORMAT.BGRA4444: case IMAGE_FORMAT.BGRA5551: case IMAGE_FORMAT.BGRX5551:
    case IMAGE_FORMAT.UV88: return 2;
    case IMAGE_FORMAT.I8: case IMAGE_FORMAT.A8: case IMAGE_FORMAT.P8: return 1;
    default: throw new Error(`vtf: unsupported format ${NAME[fmt] ?? fmt}`);
  }
}

function rgb565(v, out, o) {
  out[o] = ((v >> 11) & 31) * 255 / 31 | 0;
  out[o + 1] = ((v >> 5) & 63) * 255 / 63 | 0;
  out[o + 2] = (v & 31) * 255 / 31 | 0;
}

/** DXT1/3/5 block decode. `alphaMode`: 'none' | 'explicit' (DXT3) | 'interp' (DXT5). */
function decodeDxt(src, off, w, h, alphaMode) {
  const out = new Uint8Array(w * h * 4).fill(255);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const c = new Uint8Array(16), a = new Uint8Array(8);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let p = off + (by * bw + bx) * (alphaMode === 'none' ? 8 : 16);
    let alphaBits = null, alphaTab = null;
    if (alphaMode === 'explicit') { alphaBits = src.subarray(p, p + 8); p += 8; }
    else if (alphaMode === 'interp') {
      a[0] = src[p]; a[1] = src[p + 1];
      if (a[0] > a[1]) for (let i = 1; i < 7; i++) a[i + 1] = ((7 - i) * a[0] + i * a[1]) / 7 | 0;
      else { for (let i = 1; i < 5; i++) a[i + 1] = ((5 - i) * a[0] + i * a[1]) / 5 | 0; a[6] = 0; a[7] = 255; }
      alphaTab = src.subarray(p + 2, p + 8); p += 8;
    }
    const c0 = src.readUInt16LE(p), c1 = src.readUInt16LE(p + 2);
    rgb565(c0, c, 0); rgb565(c1, c, 4);
    // DXT1 uses c0<=c1 to signal a 1-bit-alpha block with a 3-colour ramp
    const punch = alphaMode === 'none' && c0 <= c1;
    for (let i = 0; i < 3; i++) {
      if (punch) { c[8 + i] = (c[i] + c[4 + i]) >> 1; c[12 + i] = 0; }
      else { c[8 + i] = (2 * c[i] + c[4 + i]) / 3 | 0; c[12 + i] = (c[i] + 2 * c[4 + i]) / 3 | 0; }
    }
    const bits = src.readUInt32LE(p + 4);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py;
      if (x >= w || y >= h) continue;
      const i = py * 4 + px, sel = (bits >> (i * 2)) & 3, d = (y * w + x) * 4;
      out[d] = c[sel * 4]; out[d + 1] = c[sel * 4 + 1]; out[d + 2] = c[sel * 4 + 2];
      if (punch && sel === 3) out[d + 3] = 0;
      else if (alphaMode === 'explicit') {
        const nib = alphaBits[i >> 1]; out[d + 3] = (i & 1 ? nib >> 4 : nib & 15) * 17;
      } else if (alphaMode === 'interp') {
        const bit = i * 3, byi = bit >> 3, sh = bit & 7;
        let idx = (alphaTab[byi] | (alphaTab[byi + 1] ?? 0) << 8) >> sh & 7;
        out[d + 3] = a[idx];
      }
    }
  }
  return out;
}

function decodeRaw(src, off, w, h, fmt) {
  const out = new Uint8Array(w * h * 4).fill(255);
  const bpp = bppOf(fmt);
  for (let i = 0; i < w * h; i++) {
    const s = off + i * bpp, d = i * 4;
    switch (fmt) {
      case IMAGE_FORMAT.RGBA8888: out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3]; break;
      case IMAGE_FORMAT.ABGR8888: out[d] = src[s + 3]; out[d + 1] = src[s + 2]; out[d + 2] = src[s + 1]; out[d + 3] = src[s]; break;
      case IMAGE_FORMAT.ARGB8888: out[d] = src[s + 1]; out[d + 1] = src[s + 2]; out[d + 2] = src[s + 3]; out[d + 3] = src[s]; break;
      case IMAGE_FORMAT.BGRA8888: case IMAGE_FORMAT.BGRX8888:
        out[d] = src[s + 2]; out[d + 1] = src[s + 1]; out[d + 2] = src[s];
        out[d + 3] = fmt === IMAGE_FORMAT.BGRA8888 ? src[s + 3] : 255; break;
      case IMAGE_FORMAT.RGB888: out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; break;
      case IMAGE_FORMAT.BGR888: out[d] = src[s + 2]; out[d + 1] = src[s + 1]; out[d + 2] = src[s]; break;
      case IMAGE_FORMAT.RGB565: rgb565(src.readUInt16LE(s), out, d); break;
      case IMAGE_FORMAT.BGR565: { const v = src.readUInt16LE(s); out[d + 2] = ((v >> 11) & 31) * 255 / 31 | 0; out[d + 1] = ((v >> 5) & 63) * 255 / 63 | 0; out[d] = (v & 31) * 255 / 31 | 0; break; }
      case IMAGE_FORMAT.I8: out[d] = out[d + 1] = out[d + 2] = src[s]; break;
      case IMAGE_FORMAT.IA88: out[d] = out[d + 1] = out[d + 2] = src[s]; out[d + 3] = src[s + 1]; break;
      case IMAGE_FORMAT.A8: out[d] = out[d + 1] = out[d + 2] = 255; out[d + 3] = src[s]; break;
      default: throw new Error(`vtf: unsupported raw format ${NAME[fmt] ?? fmt}`);
    }
  }
  return out;
}

export function readVtf(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'VTF\0') throw new Error(`${path}: not a VTF`);
  const verMajor = b.readUInt32LE(4), verMinor = b.readUInt32LE(8);
  const headerSize = b.readUInt32LE(12);
  const width = b.readUInt16LE(16), height = b.readUInt16LE(18);
  const flags = b.readUInt32LE(20), frames = b.readUInt16LE(24);
  const highFmt = b.readInt32LE(52);
  const mipCount = b[56];
  const lowFmt = b.readInt32LE(57);
  const lowW = b[61], lowH = b[62];
  let depth = 1;
  if (verMajor === 7 && verMinor >= 2) depth = b.readUInt16LE(63) || 1;

  // image data starts after the header, past the low-res thumbnail
  let off = headerSize;
  if (lowFmt !== -1 && lowW > 0 && lowH > 0) off += levelSize(lowFmt, lowW, lowH);

  // mips are stored smallest-first; walk to the last (largest) one
  const faceCount = (flags & 0x4000) ? 6 : 1; // TEXTUREFLAGS_ENVMAP
  for (let m = mipCount - 1; m >= 1; m--) {
    const w = Math.max(1, width >> m), h = Math.max(1, height >> m);
    off += levelSize(highFmt, w, h) * frames * faceCount * depth;
  }

  let pixels;
  if (highFmt === IMAGE_FORMAT.DXT1 || highFmt === IMAGE_FORMAT.DXT1_ONEBITALPHA)
    pixels = decodeDxt(b, off, width, height, 'none');
  else if (highFmt === IMAGE_FORMAT.DXT3) pixels = decodeDxt(b, off, width, height, 'explicit');
  else if (highFmt === IMAGE_FORMAT.DXT5) pixels = decodeDxt(b, off, width, height, 'interp');
  else pixels = decodeRaw(b, off, width, height, highFmt);

  return { width, height, flags, frames, format: NAME[highFmt] ?? highFmt, version: `${verMajor}.${verMinor}`, pixels };
}
