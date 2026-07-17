# MASTER BLASTERS

A remake of the 2007 Half-Life 2 mod, rebuilt for the browser. Quake's rocket-launcher
violence crossed with Super Smash Bros' death condition: the maps are floating
platforms over a bottomless void, and **damage never kills** — health only decides how
far the next hit sends you. Knock everyone off the platforms while your jetpack, a
limited but recharging lifeline, flies you home when they try to do it to you. Rockets
and a lightsaber in every loadout; a sniper rifle, a mini nuke, and Quad Damage fall
slowly from the sky in crates worth dying for. Stock-based rounds, three modes
(Last Man Standing, Masters vs Blasters, Timed), five maps, three tiers of bots — and
online multiplayer over WebRTC with HL2-style snapshot netcode, because a mod born on
the Source engine deserves Source-engine networking.

*The only way to die is the fall. The less life you have, the farther you fly.*

## Play

```
npm install
npm run dev        →  http://localhost:5181
```

WASD move · mouse aim · LMB fire · **Space** jump, hold to jetpack · 1-4 / wheel
weapons · C first/third person · Tab scoreboard. Rocket-jumping costs little health
and is the fastest way home — the knockback formula is on your side (self-hits:
0.4× damage, full impulse).

**Online:** one player clicks *Host a room* and shares the 4-letter code; everyone
else joins with it. The host's machine runs the match (bots welcome); clients play on
~2-3 kB/s of snapshots with client-side prediction and a lag-compensated sniper.
`npm start` builds and serves the same thing (with signaling) on :3011.

## Documents

- [docs/DESIGN.md](docs/DESIGN.md) — the reconstructed 2007 design: the one rule,
  the knockback formula, weapons, sky drops, modes, maps, bot tiers
- [docs/TECH.md](docs/TECH.md) — worker-owns-sim, the shared movement integrator
  (prediction = the same function), custom capsule-vs-AABB physics, and the live
  netcode: host-authoritative 20 Hz binary snapshots + usercmds over two WebRTC
  DataChannels, prediction replay, hitscan rewind
- [docs/ROADMAP.md](docs/ROADMAP.md) — what shipped (v1 + multiplayer) and the
  backlog (feel-gate tuning, host migration, the four remaining original maps)

Status: **v1 + phase-2 multiplayer built.** 43 headless sim tests
(`npm test` — movement, knockback properties, all four weapons, rounds, whole bot
matches, replay determinism, codec round-trips), verified end-to-end with two
browsers in one match. The tuning constants in `src/config.ts` are educated first
guesses awaiting hands that remember 2007 — the feel-gate backlog is in the roadmap.

## The original

Master Blasters was a Half-Life 2 mod released March 8, 2007, by Grayson "Big D"
Deitering (code, concept), Mark "Fallows" Fallows (maps), and Daedalus "Julian"
Raistlin (maps — MB_Moontop and MB_Crusher — optimization, and the
items-falling-from-the-sky mechanic this remake keeps at its center), with Sayyan
LeSuere, RedXIII^, and Coronius. It shipped six maps, got a server patch, a UK
community server, and an April Fools "we're going commercial" announcement that
fooled exactly the right number of people.

- [ModDB profile](https://www.moddb.com/mods/master-blasters)
- [Valve Developer Community page](https://developer.valvesoftware.com/wiki/Master_Blasters)
- [masterblastersmod.com](https://web.archive.org/web/2007/http://www.masterblastersmod.com/) (archived)

> **Sibling note.** Tech is copied/adapted from the sibling repos — Horde's
> worker-sim scheduler and shared-integrator prediction, Stargazer-Raiders'
> AABB collision, Banner's bots-as-parameter-rows — never linked. Where the
> siblings *plan* netcode, this repo has it running: `src/net/` +
> `server/signaling.js` are the reference implementation of the
> host-authoritative snapshot model (TECH §3) for any of them to copy forward.
