// Items falling from the sky — Daedalus' mechanic from the original mod. A drop
// director rolls a seeded timer, picks a map pickup spot (never the same twice
// running), and spawns the item high above it falling slowly enough to see coming
// and fight over. It lands on whatever platform is under the spot, idles, despawns.

import { CFG, TUNING as T, WPN } from '../config.ts';
import type { Prng } from '../math.ts';
import { topUnder } from './collision.ts';
import type { Box, MapDef } from './maps/types.ts';
import { PICKUP, type PickupCore, type PlayerCore, type SimEvent } from './types.ts';

export interface DropDirector {
  nextDropTick: number;
  lastSpot: number;
}

export function makeDirector(tick: number, rng: Prng): DropDirector {
  return { nextDropTick: tick + Math.round(rng.range(T.DROP_MIN_S, T.DROP_MAX_S) * CFG.TICK_HZ), lastSpot: -1 };
}

function rollKind(rng: Prng): number {
  const w = T.DROP_WEIGHTS;
  let total = 0;
  for (const v of w) total += v;
  let roll = rng.range(0, total);
  for (let k = 0; k < w.length; k++) {
    roll -= w[k];
    if (roll < 0) return k;
  }
  return PICKUP.HEALTH;
}

export function stepPickups(
  pickups: PickupCore[],
  director: DropDirector,
  map: MapDef,
  boxes: readonly Box[],
  players: PlayerCore[],
  tick: number,
  dt: number,
  rng: Prng,
  events: SimEvent[],
  nextId: () => number,
): void {
  // --- director: spawn the next sky drop ---------------------------------------
  if (tick >= director.nextDropTick && map.pickupSpots.length > 0) {
    let spot = rng.int(0, map.pickupSpots.length - 1);
    if (map.pickupSpots.length > 1 && spot === director.lastSpot) {
      spot = (spot + 1) % map.pickupSpots.length;
    }
    director.lastSpot = spot;
    const s = map.pickupSpots[spot];
    const kind = rollKind(rng);
    pickups.push({
      id: nextId(),
      kind,
      x: s.x,
      y: s.y + T.DROP_HEIGHT,
      z: s.z,
      landed: false,
      despawnAtTick: 0,
    });
    events.push({ t: 'drop', kind, x: s.x, z: s.z });
    director.nextDropTick = tick + Math.round(rng.range(T.DROP_MIN_S, T.DROP_MAX_S) * CFG.TICK_HZ);
  }

  // --- fall, land, despawn, collect ---------------------------------------------
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    if (!pk.landed) {
      pk.y -= T.DROP_FALL_SPEED * dt;
      const top = topUnder(pk.x, pk.z, 0.3, boxes);
      if (top > -Infinity && pk.y <= top) {
        pk.y = top;
        pk.landed = true;
        pk.despawnAtTick = tick + Math.round(T.PICKUP_DESPAWN_S * CFG.TICK_HZ);
      } else if (pk.y < map.killY) {
        pickups[i] = pickups[pickups.length - 1];
        pickups.pop();
        continue;
      }
    } else if (tick >= pk.despawnAtTick) {
      pickups[i] = pickups[pickups.length - 1];
      pickups.pop();
      continue;
    }

    // collection — while falling too: snatching a drop mid-jetpack is heroic
    for (const p of players) {
      if (!p.alive) continue;
      const dx = p.x - pk.x;
      const dz = p.z - pk.z;
      const r = T.PICKUP_RADIUS + T.PLAYER_R;
      if (dx * dx + dz * dz > r * r) continue;
      if (pk.y < p.y - 0.5 || pk.y > p.y + T.PLAYER_H + 0.3) continue;
      collect(p, pk.kind, tick);
      events.push({ t: 'pickup', kind: pk.kind, who: p.id });
      pickups[i] = pickups[pickups.length - 1];
      pickups.pop();
      break;
    }
  }
}

function collect(p: PlayerCore, kind: number, tick: number): void {
  switch (kind) {
    case PICKUP.HEALTH:
      p.hp = Math.min(T.PLAYER_HP, p.hp + T.HEALTH_PACK_HP);
      break;
    case PICKUP.ENERGY:
      p.energy = T.JET_ENERGY_MAX;
      break;
    case PICKUP.SNIPER:
      p.ammo[WPN.SNIPER] = Math.max(0, p.ammo[WPN.SNIPER]) + 3;
      p.weapon = WPN.SNIPER;
      break;
    case PICKUP.NUKE:
      p.ammo[WPN.NUKE] = Math.max(0, p.ammo[WPN.NUKE]) + 1;
      p.weapon = WPN.NUKE;
      break;
    case PICKUP.QUAD:
      p.quadUntilTick = tick + Math.round(T.QUAD_S * CFG.TICK_HZ);
      break;
  }
}
