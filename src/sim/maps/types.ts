// Maps are plain data — platform AABBs floating over the void — so recreating the
// 2007 layouts is a matter of editing coordinates, not code. Movers oscillate as a
// pure function of the sim tick, which means the renderer (and the prediction shim)
// can compute their positions without any replication.

export interface PlatformDef {
  x: number; y: number; z: number; // center
  w: number; h: number; d: number; // full extents
  kind?: 'static' | 'mover';
  moveAxis?: 'x' | 'y' | 'z';
  moveRange?: number; // peak offset from rest position
  moveHz?: number; // full oscillations per second
  phase?: number; // radians, staggers movers sharing a frequency
}

export interface SpawnPoint { x: number; y: number; z: number; yaw: number }

export interface MapDef {
  id: string;
  name: string;
  platforms: PlatformDef[];
  spawnPoints: SpawnPoint[]; // y = feet height (platform top)
  pickupSpots: { x: number; y: number; z: number; weight?: number }[];
  killY: number;
  gravityMult?: number; // moontop is low-gravity
  theme: {
    platform: number;
    accent: number;
    skyTop: number;
    skyBottom: number;
    fog: number;
    sun: number;
  };
  waypoints?: { x: number; y: number; z: number }[]; // optional AI hints, unused so far
}

// Runtime AABB: center + half extents. `top`/`bottom` cached because the ground
// snap and wall gate read them every player every tick.
export interface Box {
  x: number; y: number; z: number;
  hw: number; hh: number; hd: number;
  top: number;
  bottom: number;
  def: PlatformDef;
}

export function makeBoxes(map: MapDef): Box[] {
  return map.platforms.map((p) => ({
    x: p.x, y: p.y, z: p.z,
    hw: p.w / 2, hh: p.h / 2, hd: p.d / 2,
    top: p.y + p.h / 2,
    bottom: p.y - p.h / 2,
    def: p,
  }));
}

const TWO_PI = Math.PI * 2;

/** Recompute mover positions for a given tick. Mutates `boxes` in place; static
 *  platforms are untouched. Pure in tick, so sim, shim, and renderer all agree. */
export function updateMovers(boxes: Box[], tick: number, tickHz: number): void {
  for (const b of boxes) {
    const p = b.def;
    if (p.kind !== 'mover' || !p.moveAxis || !p.moveRange || !p.moveHz) continue;
    const off = Math.sin((tick / tickHz) * p.moveHz * TWO_PI + (p.phase ?? 0)) * p.moveRange;
    if (p.moveAxis === 'x') b.x = p.x + off;
    else if (p.moveAxis === 'z') b.z = p.z + off;
    else {
      b.y = p.y + off;
      b.top = b.y + b.hh;
      b.bottom = b.y - b.hh;
    }
  }
}
