// ============================================================================
// THE SIMULATION — single source of truth for game state, advanced in fixed
// ticks consuming commands. In v1 it runs in the local worker; in phase 2 this
// same class runs unchanged on the HOST (the sim never reads input devices or
// the wall clock — everything arrives as UserCmds and MatchSettings).
//
// Step order is a contract the tests lean on: cmds -> fire -> projectiles ->
// bodies -> pickups -> deaths -> respawns -> hit bookkeeping -> round logic.
// ============================================================================

import { CFG, TUNING as T, WEAPONS, WPN } from '../config.ts';
import { deriveSeed, makePrng, type Prng } from '../math.ts';
import { BTN, NEUTRAL_CMD, type MatchSettings, type UserCmd } from '../protocol.ts';
import { stepBot, makeBotState, type BotCtx } from './ai/bot.ts';
import { MAPS } from './maps/index.ts';
import { makeBoxes, updateMovers, type Box, type MapDef } from './maps/types.ts';
import { integrateBody, type MoveInput } from './movement.ts';
import { eliminationWinner, livesLeader, MODES, type ModeRules } from './modes.ts';
import { stepPickups, makeDirector, type DropDirector } from './pickups.ts';
import { stepProjectiles } from './projectiles.ts';
import {
  type BotState, type PickupCore, type PlayerCore, type ProjectileCore,
  type RoundCore, type SimEvent,
} from './types.ts';
import { tryFire, type FireCtx } from './weapons.ts';

export type Command =
  | ({ type: 'config' } & MatchSettings)
  | { type: 'input'; cmd: UserCmd };

const TICK_DT = 1 / CFG.TICK_HZ;
const KO_CREDIT_TICKS = 5 * CFG.TICK_HZ;

const NINJA_NAMES = ['Kaito', 'Shade', 'Whisper', 'Tanuki', 'Hanzo', 'Mirai', 'Kage'];
const COWBOY_NAMES = ['Tex', 'Dusty', 'Colt', 'Maverick', 'Cassidy', 'Boone', 'Wade'];

export interface Score {
  id: number;
  name: string;
  team: number;
  lives: number;
  kos: number;
  falls: number;
  bot: boolean;
  alive: boolean;
}

export class World {
  seed: number;
  tick = 0;

  settings: MatchSettings | null = null;
  map: MapDef = MAPS.mb_test;
  boxes: Box[] = makeBoxes(MAPS.mb_test);
  mode: ModeRules = MODES.lms;

  players: PlayerCore[] = [];
  botStates = new Map<number, BotState>();
  projectiles: ProjectileCore[] = [];
  pickups: PickupCore[] = [];
  director: DropDirector = { nextDropTick: 0, lastSpot: -1 };

  round: RoundCore = {
    phase: 'matchEnd',
    phaseEndsTick: 0,
    roundNumber: 0,
    suddenDeath: false,
    lastWinner: -1,
    wins: new Map(),
  };

  humanCmd: UserCmd = { ...NEUTRAL_CMD };
  events: SimEvent[] = [];

  // one PRNG stream per subsystem: drops, AI, spawn tiebreaks
  rngDrops: Prng;
  rngAi: Prng;
  rngSpawns: Prng;

  private idCounter = 1;
  private moveInput: MoveInput = { moveX: 0, moveZ: 0, jumpEdge: false, jetHeld: false };

  constructor(seed: number) {
    this.seed = seed;
    this.rngDrops = makePrng(deriveSeed(seed, 0));
    this.rngAi = makePrng(deriveSeed(seed, 1));
    this.rngSpawns = makePrng(deriveSeed(seed, 2));
  }

  get matchLive(): boolean {
    return this.settings !== null;
  }

  apply(cmd: Command): void {
    if (cmd.type === 'input') {
      this.humanCmd = cmd.cmd;
    } else if (cmd.type === 'config') {
      this.startMatch(cmd);
    }
  }

  // --- match / round lifecycle ---------------------------------------------------

  startMatch(s: MatchSettings): void {
    this.settings = s;
    this.seed = s.seed;
    this.rngDrops = makePrng(deriveSeed(s.seed, 0));
    this.rngAi = makePrng(deriveSeed(s.seed, 1));
    this.rngSpawns = makePrng(deriveSeed(s.seed, 2));
    this.map = MAPS[s.mapId] ?? MAPS.mb_test;
    this.boxes = makeBoxes(this.map);
    this.mode = MODES[s.mode];
    this.humanCmd = { ...NEUTRAL_CMD };

    this.players = [];
    this.botStates.clear();
    const n = Math.min(1 + s.botCount, CFG.MAX_PLAYERS);
    let ninjas = 0;
    let cowboys = 0;
    for (let slot = 0; slot < n; slot++) {
      const team = this.mode.assignTeam(slot);
      const bot = slot > 0;
      // team mode: even team = Masters (ninjas); FFA: alternate flavor by slot
      const ninja = this.mode.id === 'team' ? team === 0 : slot % 2 === 0;
      const name = !bot
        ? 'You'
        : ninja
          ? NINJA_NAMES[ninjas++ % NINJA_NAMES.length]
          : COWBOY_NAMES[cowboys++ % COWBOY_NAMES.length];
      this.players.push(this.makePlayer(slot, team, bot, name, ninja));
      if (bot) this.botStates.set(slot, makeBotState(s.botTier));
    }
    this.round.wins = new Map();
    this.round.roundNumber = 0;
    this.startRound();
  }

  private makePlayer(id: number, team: number, bot: boolean, name: string, ninja: boolean): PlayerCore {
    return {
      id, team, bot, name, ninja,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0,
      hp: T.PLAYER_HP,
      energy: T.JET_ENERGY_MAX,
      weapon: WPN.ROCKET,
      ammo: [-1, -1, 0, 0],
      lives: this.settings?.lives ?? T.LIVES,
      alive: true,
      respawnAtTick: 0,
      grounded: true,
      jetting: false,
      quadUntilTick: 0,
      kbLockT: 0,
      cooldownUntilTick: 0,
      kos: 0,
      falls: 0,
      prevButtons: 0,
      lastHitBy: -1,
      lastHitTick: -1_000_000,
    };
  }

  startRound(): void {
    const s = this.settings;
    if (!s) return;
    this.round.roundNumber++;
    this.round.suddenDeath = false;
    this.projectiles = [];
    this.pickups = [];
    this.director = makeDirector(this.tick, this.rngDrops);
    for (const p of this.players) {
      p.lives = s.lives;
      p.hp = T.PLAYER_HP;
      p.energy = T.JET_ENERGY_MAX;
      p.weapon = WPN.ROCKET;
      p.ammo = [-1, -1, 0, 0];
      p.quadUntilTick = 0;
      p.cooldownUntilTick = 0;
      p.kbLockT = 0;
      p.alive = true;
      p.lastHitBy = -1;
      p.lastHitTick = -1_000_000;
      this.spawn(p, true);
    }
    this.round.phase = 'countdown';
    this.round.phaseEndsTick = this.tick + Math.round(T.COUNTDOWN_S * CFG.TICK_HZ);
    this.events.push({ t: 'round', phase: 'countdown', winnerTeam: -1, winnerName: '' });
  }

  /** Place a (re)spawning player at the point farthest from living enemies. */
  private spawn(p: PlayerCore, roundStart = false): void {
    const spots = this.map.spawnPoints;
    let best = roundStart ? spots[p.id % spots.length] : spots[0];
    if (!roundStart) {
      let bestScore = -Infinity;
      for (const sp of spots) {
        let nearest = Infinity;
        for (const q of this.players) {
          if (!q.alive || q.id === p.id) continue;
          const d = Math.hypot(q.x - sp.x, q.z - sp.z);
          if (d < nearest) nearest = d;
        }
        const score = nearest + this.rngSpawns.range(0, 0.01); // seeded tiebreak
        if (score > bestScore) {
          bestScore = score;
          best = sp;
        }
      }
    }
    p.x = best.x;
    p.y = best.y;
    p.z = best.z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.yaw = best.yaw;
    p.pitch = 0;
    p.hp = T.PLAYER_HP;
    p.energy = T.JET_ENERGY_MAX;
    p.grounded = true;
    p.jetting = false;
    p.kbLockT = 0;
    p.alive = true;
  }

  private endRound(winnerTeam: number): void {
    this.round.lastWinner = winnerTeam;
    let matchOver = false;
    let name = 'Draw';
    if (winnerTeam >= 0) {
      const wins = (this.round.wins.get(winnerTeam) ?? 0) + 1;
      this.round.wins.set(winnerTeam, wins);
      matchOver = wins >= T.ROUNDS_TO_WIN;
      name = this.mode.teamName(winnerTeam, this.players);
    }
    this.round.phase = matchOver ? 'matchEnd' : 'roundEnd';
    this.round.phaseEndsTick = this.tick + Math.round(T.ROUND_END_S * CFG.TICK_HZ);
    this.events.push({
      t: 'round',
      phase: this.round.phase,
      winnerTeam,
      winnerName: name,
    });
  }

  // --- the tick -------------------------------------------------------------------

  step(): void {
    this.tick++;
    updateMovers(this.boxes, this.tick, CFG.TICK_HZ);
    if (!this.matchLive) return;

    const r = this.round;
    const eventMark = this.events.length;
    const active = r.phase === 'active';

    // 1) inputs: humans from the latest cmd, bots from their brains
    const botCtx: BotCtx = {
      players: this.players,
      pickups: this.pickups,
      boxes: this.boxes,
      tick: this.tick,
      rng: this.rngAi,
      friendlyFire: this.mode.friendlyFire,
    };
    for (const p of this.players) {
      const cmd = p.bot ? stepBot(p, this.botStates.get(p.id)!, botCtx) : this.humanCmd;
      p.yaw = cmd.yaw;
      p.pitch = cmd.pitch;
      if (cmd.weapon >= 0 && cmd.weapon < WEAPONS.length && p.ammo[cmd.weapon] !== 0) {
        p.weapon = cmd.weapon;
      }
      const jumpEdge = (cmd.buttons & BTN.JUMP) !== 0 && (p.prevButtons & BTN.JUMP) === 0;
      const jetHeld = (cmd.buttons & BTN.JET) !== 0;
      const fire = (cmd.buttons & BTN.FIRE) !== 0;
      p.prevButtons = cmd.buttons;

      if (active && fire) {
        tryFire(p, this.fireCtx());
      }

      // bodies move during active AND round-end (the winner gets a victory lap);
      // countdown freezes everyone at their spawn
      if (r.phase !== 'countdown' && p.alive) {
        this.moveInput.moveX = cmd.moveX;
        this.moveInput.moveZ = cmd.moveZ;
        this.moveInput.jumpEdge = jumpEdge;
        this.moveInput.jetHeld = jetHeld;
        integrateBody(p, this.moveInput, TICK_DT, this.boxes, this.map.gravityMult ?? 1);
      }
    }

    // 2) projectiles fly and explode
    stepProjectiles(
      this.projectiles, this.players, this.boxes, this.tick, TICK_DT,
      this.map.gravityMult ?? 1, this.mode.friendlyFire, this.map.killY, this.events,
    );

    // 3) the sky provides
    if (active) {
      stepPickups(
        this.pickups, this.director, this.map, this.boxes, this.players,
        this.tick, TICK_DT, this.rngDrops, this.events, () => this.idCounter++,
      );
    }

    // 4) hit bookkeeping (KO credit), from events pushed this tick
    for (let i = eventMark; i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev.t === 'hit' && !ev.self) {
        const victim = this.players[ev.victim];
        victim.lastHitBy = ev.attacker;
        victim.lastHitTick = this.tick;
      }
    }

    // 5) the void collects
    for (const p of this.players) {
      if (!p.alive || p.y >= this.map.killY) continue;
      p.alive = false;
      p.falls++;
      if (r.phase === 'active' || r.phase === 'countdown') p.lives--;
      const credit =
        p.lastHitBy >= 0 && this.tick - p.lastHitTick <= KO_CREDIT_TICKS && p.lastHitBy !== p.id
          ? p.lastHitBy
          : -1;
      if (credit >= 0) this.players[credit].kos++;
      this.events.push({ t: 'ko', victim: p.id, attacker: credit });
      if (p.lives > 0) p.respawnAtTick = this.tick + Math.round(T.RESPAWN_S * CFG.TICK_HZ);
    }

    // 6) respawns
    if (active) {
      for (const p of this.players) {
        if (!p.alive && p.lives > 0 && this.tick >= p.respawnAtTick) this.spawn(p);
      }
    }

    // 7) round state machine
    if (r.phase === 'countdown') {
      if (this.tick >= r.phaseEndsTick) {
        r.phase = 'active';
        r.phaseEndsTick = this.mode.usesTimer
          ? this.tick + Math.round(T.TIMED_ROUND_S * CFG.TICK_HZ)
          : Number.MAX_SAFE_INTEGER;
        this.events.push({ t: 'round', phase: 'active', winnerTeam: -1, winnerName: '' });
      }
    } else if (r.phase === 'active') {
      let winner = eliminationWinner(this.players);
      if (winner === null && this.mode.usesTimer) {
        if (r.suddenDeath) {
          // next KO decides: any unique lives leader ends it
          winner = livesLeader(this.players);
        } else if (this.tick >= r.phaseEndsTick) {
          winner = livesLeader(this.players);
          if (winner === null) {
            r.suddenDeath = true;
            this.events.push({ t: 'round', phase: 'active', winnerTeam: -2, winnerName: 'SUDDEN DEATH' });
          }
        }
      }
      if (winner !== null) this.endRound(winner);
    } else if (r.phase === 'roundEnd') {
      if (this.tick >= r.phaseEndsTick) this.startRound();
    }
    // matchEnd: hold until the menu sends a new config
  }

  private fireCtx(): FireCtx {
    return {
      players: this.players,
      boxes: this.boxes,
      projectiles: this.projectiles,
      pickups: this.pickups,
      events: this.events,
      tick: this.tick,
      friendlyFire: this.mode.friendlyFire,
      nextId: () => this.idCounter++,
    };
  }

  // --- frame packing (worker -> main). Fresh buffers each call: they transfer. ----

  scoreboard(): Score[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, lives: p.lives,
      kos: p.kos, falls: p.falls, bot: p.bot, alive: p.alive,
    }));
  }

  pack(): { msg: Record<string, unknown>; transfers: Transferable[] } {
    const S = 22;
    const players = new Float32Array(this.players.length * S);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const o = i * S;
      players[o] = p.id;
      players[o + 1] = p.x;
      players[o + 2] = p.y;
      players[o + 3] = p.z;
      players[o + 4] = p.vx;
      players[o + 5] = p.vy;
      players[o + 6] = p.vz;
      players[o + 7] = p.yaw;
      players[o + 8] = p.pitch;
      players[o + 9] = p.hp;
      players[o + 10] = p.energy;
      players[o + 11] = p.weapon;
      players[o + 12] = p.lives;
      players[o + 13] = p.alive ? 1 : 0;
      players[o + 14] = p.team;
      players[o + 15] = Math.max(0, p.quadUntilTick - this.tick) / CFG.TICK_HZ;
      players[o + 16] = p.kos;
      players[o + 17] = p.falls;
      players[o + 18] = p.bot ? 1 : 0;
      players[o + 19] = p.jetting ? 1 : 0;
      players[o + 20] = p.grounded ? 1 : 0;
      players[o + 21] = p.ninja ? 1 : 0;
    }

    const PS = 10;
    const projectiles = new Float32Array(this.projectiles.length * PS);
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      const o = i * PS;
      projectiles[o] = pr.id;
      projectiles[o + 1] = pr.kind;
      projectiles[o + 2] = pr.x;
      projectiles[o + 3] = pr.y;
      projectiles[o + 4] = pr.z;
      projectiles[o + 5] = pr.vx;
      projectiles[o + 6] = pr.vy;
      projectiles[o + 7] = pr.vz;
      projectiles[o + 8] = pr.quad ? 1 : 0;
      projectiles[o + 9] = pr.ownerTeam;
    }

    const KS = 6;
    const pickups = new Float32Array(this.pickups.length * KS);
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      const o = i * KS;
      pickups[o] = pk.id;
      pickups[o + 1] = pk.kind;
      pickups[o + 2] = pk.x;
      pickups[o + 3] = pk.y;
      pickups[o + 4] = pk.z;
      pickups[o + 5] = pk.landed ? 1 : 0;
    }

    const human = this.players[0];
    const r = this.round;
    const events = this.events;
    this.events = [];

    const msg = {
      type: 'frame',
      tick: this.tick,
      players,
      nPlayers: this.players.length,
      names: this.players.map((p) => p.name),
      projectiles,
      nProjectiles: this.projectiles.length,
      pickups,
      nPickups: this.pickups.length,
      events,
      matchLive: this.matchLive,
      mapId: this.map.id,
      round: {
        phase: r.phase,
        roundNumber: r.roundNumber,
        suddenDeath: r.suddenDeath,
        countdownS: r.phase === 'countdown' ? Math.max(0, (r.phaseEndsTick - this.tick) / CFG.TICK_HZ) : 0,
        timeLeftS:
          this.mode.usesTimer && r.phase === 'active' && r.phaseEndsTick < Number.MAX_SAFE_INTEGER
            ? Math.max(0, (r.phaseEndsTick - this.tick) / CFG.TICK_HZ)
            : -1,
        wins: [...r.wins.entries()],
      },
      scores: this.scoreboard(),
      hud: human
        ? {
            hp: human.hp,
            energy: human.energy,
            weapon: human.weapon,
            ammo: [...human.ammo],
            lives: human.lives,
            alive: human.alive,
            quadS: Math.max(0, human.quadUntilTick - this.tick) / CFG.TICK_HZ,
            respawnS: human.alive ? 0 : Math.max(0, (human.respawnAtTick - this.tick) / CFG.TICK_HZ),
            kos: human.kos,
            falls: human.falls,
          }
        : null,
      simTps: 0, // stamped by the worker scheduler
    };
    return { msg, transfers: [players.buffer, projectiles.buffer, pickups.buffer] };
  }
}
