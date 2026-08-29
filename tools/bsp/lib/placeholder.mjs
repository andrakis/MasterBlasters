// Generated stand-ins for materials we deliberately do not ship.
//
// Two different situations, two different answers:
//
//  void  — the map's world-seal used HALFLIFE/BLACK, a Valve material that is
//          literally flat black. Reproducing "black" is not shipping Valve's
//          asset, so this is a correct reimplementation, not a placeholder.
//  missing — a real texture we can't legally ship. This must look OBVIOUSLY
//          wrong: a silent black surface reads as a rendering bug (it did, and
//          it cost us a debugging round).
export function voidTexture(size = 8) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { px[i * 4 + 3] = 255; }
  return { width: size, height: size, pixels: px };
}

/** Magenta/black checker with a diagonal slash — the universal "no texture". */
export function missingTexture(size = 128, label = true) {
  const px = new Uint8Array(size * size * 4);
  const cell = size / 8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const checker = ((x / cell | 0) + (y / cell | 0)) & 1;
    // magenta on near-black, the convention every engine uses for a missing map
    px[i] = checker ? 255 : 24;
    px[i + 1] = checker ? 0 : 8;
    px[i + 2] = checker ? 255 : 24;
    px[i + 3] = 255;
    if (label) {
      // a bright diagonal so it is unmistakable even on a single small face
      const d = Math.abs(x - y);
      const d2 = Math.abs(x - (size - 1 - y));
      if (d < 3 || d2 < 3) { px[i] = 255; px[i + 1] = 220; px[i + 2] = 0; }
    }
  }
  return { width: size, height: size, pixels: px };
}
