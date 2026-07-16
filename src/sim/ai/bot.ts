// Bot opponents. One rule from Banner's aiDuelist: a bot is the SAME actor as a
// human — it emits a UserCmd through the identical input seam, and skill tiers are
// parameter rows (config.ts AI_TIERS), never different code paths. Runs host-side
// only (BotState never replicates).
//
// Behaviors: fight (orbit-strafe and shoot), collect (walk a needed sky drop),
// edgeGuard (punish an enemy jetpacking back), recover (get home when knocked off).

import { AI_TIERS, CFG, TUNING as T, WEAPONS, WPN } from '../../config.ts';
import type { Prng } from '../../math.ts';
import { BTN, NEUTRAL_CMD, type UserCmd } from '../../protocol.ts';
import { centerY } from '../combat.ts';
import { overAnyPlatform } from '../collision.ts';
import type { Box } from '../maps/types.ts';
import { PICKUP, type BotState, type PickupCore, type PlayerCore } from '../types.ts';

export interface BotCtx {
  players: readonly PlayerCore[];
  pickups: readonly PickupCore[];
  boxes: readonly Box[];
  tick: number;
  rng: Prng;
  friendlyFire: boolean;
}

export function makeBotState(tier: number): BotState {
  return {
    tier,
    behavior: 'fight',
    targetId: -1,
    pickupId: -1,
    decideAtTick: 0,
    fireOkAtTick: 0,
    recoverAtTick: -1,
    strafeDir: 1,
    strafeFlipTick: 0,
    jitterYaw: 0,
    jitterPitch: 0,
    cmd: { ...NEUTRAL_CMD },
  };
}

const EDGE_PROBE = T.PLAYER_R * 3;

function enemiesOf(p: PlayerCore, ctx: BotCtx): PlayerCore[] {
  return ctx.players.filter(
    (q) => q.alive && q.id !== p.id && (ctx.friendlyFire || q.team !== p.team),
  );
}

function distXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** Nearest safe stand point: own XZ clamped into a platform footprint (with margin). */
function nearestPlatformPoint(p: PlayerCore, boxes: readonly Box[]): { x: number; y: number; z: number } {
  let best = { x: 0, y: 0, z: 0 };
  let bestScore = Infinity;
  for (const b of boxes) {
    const margin = Math.min(1, b.hw / 2, b.hd / 2);
    const cx = Math.max(b.x - b.hw + margin, Math.min(b.x + b.hw - margin, p.x));
    const cz = Math.max(b.z - b.hd + margin, Math.min(b.z + b.hd - margin, p.z));
    const dh = distXZ(p.x, p.z, cx, cz);
    const climb = Math.max(0, b.top - p.y);
    const score = dh + climb * 1.5; // climbing costs jetpack; prefer level or lower tops
    if (score < bestScore) {
      bestScore = score;
      best = { x: cx, y: b.top, z: cz };
    }
  }
  return best;
}

/** Aim the cmd at a world point, with the tier's persistent jitter attached. */
function aimAt(cmd: UserCmd, p: PlayerCore, tx: number, ty: number, tz: number, jitterYaw: number, jitterPitch: number): void {
  const eyeY = p.y + T.EYE_HEIGHT;
  const dx = tx - p.x;
  const dy = ty - eyeY;
  const dz = tz - p.z;
  cmd.yaw = Math.atan2(-dx, -dz) + jitterYaw;
  cmd.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + jitterPitch;
}

/** Steer, but never blindly off an edge: if the probe ahead finds void, blend the
 *  wish direction back toward the nearest platform interior. */
function safeMove(cmd: UserCmd, p: PlayerCore, wishX: number, wishZ: number, boxes: readonly Box[]): void {
  const len = Math.hypot(wishX, wishZ);
  if (len < 1e-6) {
    cmd.moveX = 0;
    cmd.moveZ = 0;
    return;
  }
  const nx = wishX / len;
  const nz = wishZ / len;
  if (!overAnyPlatform(p.x + nx * EDGE_PROBE, p.z + nz * EDGE_PROBE, -0.1, boxes)) {
    const home = nearestPlatformPoint(p, boxes);
    const hx = home.x - p.x;
    const hz = home.z - p.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      cmd.moveX = hx / hl;
      cmd.moveZ = hz / hl;
      return;
    }
  }
  cmd.moveX = nx;
  cmd.moveZ = nz;
}

export function stepBot(p: PlayerCore, bs: BotState, ctx: BotCtx): UserCmd {
  const tier = AI_TIERS[bs.tier];
  const cmd = bs.cmd;
  cmd.buttons = 0;
  cmd.moveX = 0;
  cmd.moveZ = 0;
  cmd.weapon = -1;
  if (!p.alive) return cmd;

  const { rng, tick, boxes } = ctx;
  const over = overAnyPlatform(p.x, p.z, 0, boxes);

  // --- recover overrides everything: get back over land or die. Clumsy tiers
  // NOTICE they're off the map late (reaction-scaled), which is where most of
  // their deaths come from — exactly like a panicking human.
  if (!over || p.vy < -14) {
    if (bs.behavior !== 'recover') {
      if (bs.recoverAtTick < 0) {
        bs.recoverAtTick = tick + Math.round(tier.reactionS * 2.5 * CFG.TICK_HZ);
      }
      if (tick >= bs.recoverAtTick) bs.behavior = 'recover';
    }
  } else {
    bs.recoverAtTick = -1;
    if (bs.behavior === 'recover' && p.grounded) {
      bs.behavior = 'fight';
      bs.decideAtTick = 0; // rethink immediately after making it home
    }
  }

  if (bs.behavior === 'recover') {
    const home = nearestPlatformPoint(p, boxes);
    safeMoveRaw(cmd, p, home.x - p.x, home.z - p.z);
    aimAt(cmd, p, home.x, home.y + 1, home.z, 0, 0);
    // jetpack budget: skilled bots feather (thrust only while vy is low), clumsy
    // ones hold the button and flame out — recoverySkill sets the feather cap
    const vyCap = 1.5 + (1 - tier.recoverySkill) * 7;
    const needAltitude = p.y < home.y + 0.5;
    if (needAltitude && p.vy < vyCap && p.energy > 0) cmd.buttons |= BTN.JET;
    return cmd;
  }

  // --- periodic rethink -----------------------------------------------------------
  const enemies = enemiesOf(p, ctx);
  if (tick >= bs.decideAtTick) {
    bs.decideAtTick = tick + Math.round(rng.range(tier.decideS[0], tier.decideS[1]) * CFG.TICK_HZ);
    bs.jitterYaw = (rng.next() * 2 - 1) * tier.aimJitterRad;
    bs.jitterPitch = (rng.next() * 2 - 1) * tier.aimJitterRad;

    // edge-guard: someone is off the platforms trying to come home
    const falling = enemies.find((q) => !overAnyPlatform(q.x, q.z, 0, boxes));
    const wantPickup = pickTarget(p, ctx);
    if (falling && rng.chance(tier.edgeGuard)) {
      bs.behavior = 'edgeGuard';
      bs.targetId = falling.id;
    } else if (wantPickup !== -1 && rng.chance(0.7)) {
      bs.behavior = 'collect';
      bs.pickupId = wantPickup;
    } else {
      bs.behavior = 'fight';
      let best: PlayerCore | null = null;
      let bestD = Infinity;
      for (const q of enemies) {
        const d = distXZ(p.x, p.z, q.x, q.z);
        if (d < bestD) { bestD = d; best = q; }
      }
      const newTarget = best ? best.id : -1;
      if (newTarget !== bs.targetId) bs.fireOkAtTick = tick + Math.round(tier.reactionS * CFG.TICK_HZ);
      bs.targetId = newTarget;
    }
  }
  if (tick >= bs.strafeFlipTick) {
    bs.strafeDir = rng.chance(0.5) ? 1 : -1;
    // skilled bots juke more often — predictable strafes are what lead-aim eats
    const pace = 1.6 - tier.leadSkill;
    bs.strafeFlipTick = tick + Math.round(rng.range(0.8, 2.2) * pace * CFG.TICK_HZ);
  }

  // --- collect ---------------------------------------------------------------------
  if (bs.behavior === 'collect') {
    const pk = ctx.pickups.find((k) => k.id === bs.pickupId);
    if (!pk) {
      bs.behavior = 'fight';
      bs.decideAtTick = 0;
      return cmd;
    }
    safeMove(cmd, p, pk.x - p.x, pk.z - p.z, boxes);
    aimAt(cmd, p, pk.x, pk.y, pk.z, 0, 0);
    if (pk.y > p.y + 1.2 && p.vy < 2 && p.energy > T.JET_MIN_START) cmd.buttons |= BTN.JET;
    return cmd;
  }

  // --- fight / edgeGuard -------------------------------------------------------------
  const target = ctx.players.find((q) => q.id === bs.targetId && q.alive);
  if (!target) {
    bs.decideAtTick = 0;
    return cmd;
  }
  const dist = distXZ(p.x, p.z, target.x, target.z);

  // weapon choice
  let want: number = WPN.ROCKET;
  // saber is a finisher: close in only on softened targets (huge knockback +
  // jet drain), never trade blade-range with a healthy rocket
  const saberMode = dist < 5 && target.hp < 55 && rng.chance(tier.saberChance);
  const targetAirborne = !overAnyPlatform(target.x, target.z, 0, boxes);
  if (p.ammo[WPN.NUKE] !== 0 && dist > 12 && nearbyCount(target, enemies, 6) >= 2) want = WPN.NUKE;
  else if (p.ammo[WPN.SNIPER] !== 0 && (targetAirborne || dist > 15)) want = WPN.SNIPER;
  else if (saberMode || dist < 2.5) want = WPN.SABER;
  if (want !== p.weapon) cmd.weapon = want;
  const spec = WEAPONS[want];

  // movement: keep the band, orbit-strafe; edge guards hold the lip instead
  if (bs.behavior === 'edgeGuard') {
    const toX = target.x - p.x;
    const toZ = target.z - p.z;
    // advance toward the enemy's return line but let safeMove keep us on the deck
    safeMove(cmd, p, toX, toZ, boxes);
  } else {
    const toX = (target.x - p.x) / Math.max(dist, 1e-6);
    const toZ = (target.z - p.z) / Math.max(dist, 1e-6);
    const nearBand = want === WPN.SABER ? 1.6 : 7;
    const farBand = want === WPN.SABER ? 2.0 : 14;
    let approach = 0;
    if (dist > farBand) approach = 1;
    else if (dist < nearBand) approach = -1;
    // gap ahead while closing distance: with fuel in the tank, COMMIT — jump the
    // void and jet across, instead of orbiting a separate island forever
    const gapAhead = !overAnyPlatform(p.x + toX * EDGE_PROBE, p.z + toZ * EDGE_PROBE, -0.1, boxes);
    if (approach === 1 && gapAhead && p.energy > 55) {
      cmd.moveX = toX;
      cmd.moveZ = toZ;
      cmd.buttons |= BTN.JUMP;
      // fuel discipline: the jump itself crosses most gaps — jet only when
      // actually sinking below the far ledge, never to pad a healthy arc
      if (!p.grounded && p.vy < 1 && p.y < target.y + 0.5) cmd.buttons |= BTN.JET;
    } else {
      // perpendicular strafe + radial correction
      const wishX = -toZ * bs.strafeDir + toX * approach;
      const wishZ = toX * bs.strafeDir + toZ * approach;
      safeMove(cmd, p, wishX, wishZ, boxes);
      if (p.grounded && rng.chance(0.008)) cmd.buttons |= BTN.JUMP; // unpredictability hop
    }
  }

  // aim: lead projectiles by the target's velocity, per the tier's leadSkill
  let ax = target.x;
  let ay = centerY(target);
  let az = target.z;
  if (spec.kind === 'projectile' && spec.projSpeed > 0) {
    const tof = Math.hypot(ax - p.x, ay - (p.y + T.EYE_HEIGHT), az - p.z) / spec.projSpeed;
    ax += target.vx * tof * tier.leadSkill;
    ay += target.vy * tof * tier.leadSkill * 0.5; // vertical lead overshoots feel dumb; halve it
    az += target.vz * tof * tier.leadSkill;
    if (target.grounded) ay = target.y + 0.4; // splash the floor under grounded targets
  }
  aimAt(cmd, p, ax, ay, az, bs.jitterYaw, bs.jitterPitch);

  // fire control
  const inRange =
    spec.kind === 'melee' ? dist < spec.reach + T.PLAYER_R :
    want === WPN.NUKE ? dist > spec.splashR * 0.9 : // don't nuke your own feet
    dist < 45;
  if (inRange && tick >= bs.fireOkAtTick && tick >= p.cooldownUntilTick) {
    cmd.buttons |= BTN.FIRE;
    // per-shot rhythm: the tier's reaction time gates every trigger pull, and the
    // aim error rerolls, so a Greenhorn's volley is slow AND scattered
    bs.fireOkAtTick = tick + Math.round(tier.reactionS * 2 * CFG.TICK_HZ);
    bs.jitterYaw = (rng.next() * 2 - 1) * tier.aimJitterRad;
    bs.jitterPitch = (rng.next() * 2 - 1) * tier.aimJitterRad;
  }
  return cmd;
}

/** Raw steer without the edge probe — recovery WANTS to cross the void. */
function safeMoveRaw(cmd: UserCmd, _p: PlayerCore, wishX: number, wishZ: number): void {
  const len = Math.hypot(wishX, wishZ);
  if (len < 1e-6) return;
  cmd.moveX = wishX / len;
  cmd.moveZ = wishZ / len;
}

function nearbyCount(center: PlayerCore, players: readonly PlayerCore[], radius: number): number {
  let n = 0;
  for (const q of players) {
    if (distXZ(center.x, center.z, q.x, q.z) < radius) n++;
  }
  return n;
}

/** Which pickup (id) is worth walking to right now, if any. */
function pickTarget(p: PlayerCore, ctx: BotCtx): number {
  let best = -1;
  let bestScore = Infinity;
  for (const pk of ctx.pickups) {
    const d = distXZ(p.x, p.z, pk.x, pk.z);
    if (d > 16) continue;
    let need = 0;
    if (pk.kind === PICKUP.HEALTH) need = p.hp < 55 ? 2 : 0;
    else if (pk.kind === PICKUP.ENERGY) need = p.energy < 35 ? 2 : 0;
    else if (pk.kind === PICKUP.QUAD) need = 1.5;
    else need = 1; // weapons are always nice
    if (need === 0) continue;
    const score = d / need;
    if (score < bestScore) {
      bestScore = score;
      best = pk.id;
    }
  }
  return best;
}
