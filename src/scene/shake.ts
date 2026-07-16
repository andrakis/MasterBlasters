// Tiny shared camera-shake accumulator. Effects.tsx feeds it (explosion proximity),
// PlayerRig.tsx consumes it every frame. Render-only state — never sim input.

let magnitude = 0;

export function addShake(m: number): void {
  magnitude = Math.min(1.2, magnitude + m);
}

/** Decay and return the current shake magnitude. Call once per render frame. */
export function stepShake(dt: number): number {
  magnitude *= Math.exp(-7 * dt);
  if (magnitude < 0.001) magnitude = 0;
  return magnitude;
}
