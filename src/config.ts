// Single source of truth for structural constants and gameplay tuning.
// Change values here, not as magic numbers in the loops. Knockback and jetpack
// numbers were feel-tuned in the M2 gate on the test arena; touch with care.

export const CFG = {
  TICK_HZ: 60, // fixed sim tick (Quake-style projectile dodging wants 60)
  MAX_CATCHUP: 6, // max ticks per worker wake before dropping time debt
  SEED: 0xb1a57e12, // default run seed; menu rerolls per match

  // Replication (phase 2, live): host sim runs at TICK_HZ; the wire does not.
  CMD_HZ: 30, // client -> host usercmd rate
  SNAP_EVERY: 3, // host -> client snapshot every N ticks (60/3 = 20 Hz)
  INTERP_MS: 100, // remote entities render this far in the past (cl_interp)
  LAG_COMP_MAX_TICKS: 60, // hitscan rewind cap (1 s of position history)

  MAX_PLAYERS: 8,
} as const;

export const TUNING = {
  // --- body & movement -------------------------------------------------------
  PLAYER_R: 0.45,
  PLAYER_H: 1.8,
  EYE_HEIGHT: 1.65,
  RUN_SPEED: 9,
  ACCEL: 10, // ground, exponential approach toward desired velocity
  AIR_ACCEL: 3,
  JUMP_VY: 8.5,
  GRAVITY: 24,
  MAX_FALL: 40,
  STEP_MAX: 0.35, // max ledge the ground snap will step up/down
  KB_FRICTION_LOCK: 0.35, // seconds of suppressed ground accel after taking a hit
  KB_LOCK_ACCEL_MULT: 0.15,

  // --- jetpack ---------------------------------------------------------------
  JET_ENERGY_MAX: 100,
  JET_ACCEL: 34, // net +10 up against gravity
  JET_DRAIN: 40, // energy/s while thrusting
  JET_RECHARGE: 14, // energy/s grounded; halved airborne; none while thrusting
  JET_AIR_RECHARGE_MULT: 0.5,
  JET_MIN_START: 5, // can't begin thrusting on fumes (feathering at zero)

  // --- health & knockback ----------------------------------------------------
  PLAYER_HP: 100, // damage never kills: hp clamps at 0 and only scales knockback
  KB_BASE: 3.0,
  KB_DMG: 0.1,
  KB_HP_SCALE: 2.5, // a 0-hp victim flies 3.5x as far as a full-hp one
  KB_UP_BIAS: 0.35, // minimum upward component of any knockback direction
  SELF_DMG_MULT: 0.4,
  SELF_KB_MULT: 1.0, // rocket jumping is core mobility — full self-impulse

  // --- rounds & stocks -------------------------------------------------------
  LIVES: 4,
  ROUNDS_TO_WIN: 3,
  RESPAWN_S: 1.5,
  COUNTDOWN_S: 3,
  ROUND_END_S: 4,
  TIMED_ROUND_S: 300,

  // --- pickups falling from the sky (Daedalus' mechanic) ----------------------
  DROP_MIN_S: 10,
  DROP_MAX_S: 18,
  DROP_HEIGHT: 22, // spawn this far above the pickup spot
  DROP_FALL_SPEED: 7, // slow enough to see coming and contest
  PICKUP_DESPAWN_S: 20,
  PICKUP_RADIUS: 0.8,
  HEALTH_PACK_HP: 50,
  QUAD_S: 12,
  QUAD_MULT: 2.5, // damage AND knockback
  // spawn weight per kind: health, energy, sniper, nuke, quad
  DROP_WEIGHTS: [30, 30, 15, 10, 15],
} as const;

// Weapon slots. Rocket and saber are the loadout; sniper and nuke arrive by sky drop.
export const WPN = { ROCKET: 0, SABER: 1, SNIPER: 2, NUKE: 3 } as const;

export interface WeaponSpec {
  name: string;
  kind: 'projectile' | 'melee' | 'hitscan';
  cooldownS: number;
  dmg: number;
  kbMult: number;
  // projectile
  projSpeed: number;
  projGravityMult: number; // 0 = straight rocket, 0.5 = lobbed nuke
  splashR: number; // 0 = direct-hit only
  projLifeS: number;
  // melee
  reach: number;
  halfArcCos: number; // cos of the half-angle of the swing cone
  energyDrain: number; // saber's anti-recovery identity: drains victim jetpack
  // ammo: -1 = infinite, else granted per pickup
  ammoPerPickup: number;
}

export const WEAPONS: readonly WeaponSpec[] = [
  {
    name: 'Rocket Launcher', kind: 'projectile', cooldownS: 0.9, dmg: 22, kbMult: 1.0,
    projSpeed: 28, projGravityMult: 0, splashR: 4, projLifeS: 6,
    reach: 0, halfArcCos: 0, energyDrain: 0, ammoPerPickup: -1,
  },
  {
    name: 'Lightsaber', kind: 'melee', cooldownS: 0.6, dmg: 8, kbMult: 1.25,
    projSpeed: 0, projGravityMult: 0, splashR: 0, projLifeS: 0,
    reach: 2.3, halfArcCos: 0.574, // cos(55°) — a 110° swing cone
    energyDrain: 30, ammoPerPickup: -1,
  },
  {
    name: 'Sniper Rifle', kind: 'hitscan', cooldownS: 1.5, dmg: 15, kbMult: 1.6,
    projSpeed: 0, projGravityMult: 0, splashR: 0, projLifeS: 0,
    reach: 0, halfArcCos: 0, energyDrain: 0, ammoPerPickup: 3,
  },
  {
    name: 'Mini Nuke', kind: 'projectile', cooldownS: 2.0, dmg: 45, kbMult: 1.5,
    projSpeed: 16, projGravityMult: 0.5, splashR: 10, projLifeS: 8,
    reach: 0, halfArcCos: 0, energyDrain: 0, ammoPerPickup: 1,
  },
];

// --- bots: skill is a parameter row, never a different code path ---------------
export interface AiTier {
  name: string;
  reactionS: number; // delay between acquiring a target and first shot
  aimJitterRad: number; // gaussian-ish error added to every aim solution
  leadSkill: number; // 0..1 blend toward the correct projectile intercept
  decideS: [number, number]; // how often the bot rethinks target/behavior
  edgeGuard: number; // chance to chase a knock-off with edge-guard fire
  recoverySkill: number; // 0..1 how optimally it feathers the jetpack home
  saberChance: number; // chance to close to saber range instead of shooting
}

export const AI_TIERS: readonly AiTier[] = [
  {
    name: 'Greenhorn', reactionS: 0.45, aimJitterRad: 0.09, leadSkill: 0.4,
    decideS: [0.8, 1.5], edgeGuard: 0.1, recoverySkill: 0.5, saberChance: 0.2,
  },
  {
    name: 'Gunslinger', reactionS: 0.3, aimJitterRad: 0.05, leadSkill: 0.7,
    decideS: [0.5, 1.0], edgeGuard: 0.4, recoverySkill: 0.8, saberChance: 0.5,
  },
  {
    name: 'Master', reactionS: 0.18, aimJitterRad: 0.025, leadSkill: 0.95,
    decideS: [0.3, 0.7], edgeGuard: 0.8, recoverySkill: 0.97, saberChance: 0.8,
  },
];

// Flat-buffer strides for worker->main frames. Update pack() (world.ts) and the
// consuming renderer together when these change.
export const STRIDE = {
  // id,x,y,z,vx,vy,vz,yaw,pitch,hp,energy,weapon,lives,alive,team,quadT,kos,
  // falls,bot,jetting,grounded,ninja,ammoSniper,ammoNuke,respawnS,lastCmdSeq
  PLAYER: 26,
  PROJECTILE: 10, // id,kind,x,y,z,vx,vy,vz,quad,ownerTeam
  PICKUP: 6, // id,kind,x,y,z,landed
} as const;

// Flat-buffer field offsets for the player record (renderer + codec + HUD).
export const P = {
  ID: 0, X: 1, Y: 2, Z: 3, VX: 4, VY: 5, VZ: 6, YAW: 7, PITCH: 8, HP: 9,
  ENERGY: 10, WEAPON: 11, LIVES: 12, ALIVE: 13, TEAM: 14, QUAD_T: 15, KOS: 16,
  FALLS: 17, BOT: 18, JETTING: 19, GROUNDED: 20, NINJA: 21, AMMO_SNIPER: 22,
  AMMO_NUKE: 23, RESPAWN_S: 24, CMD_SEQ: 25,
} as const;
