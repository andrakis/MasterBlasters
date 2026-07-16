# CLAUDE.md

Context for Claude when working on this project. Read `docs/DESIGN.md` and
`docs/TECH.md` before making changes; `docs/ROADMAP.md` tracks what's next.

## What this is
**MASTER BLASTERS** — a Three.js remake of the 2007 Half-Life 2 mod of the same
name, which the project owner (Daedalus/Julian) helped build. Quake rocket combat ×
Super Smash Bros ring-outs, first-person: floating platforms over a void, damage
never kills (it scales knockback), a recharging jetpack flies you home, stock-based
rounds. v1 is local-vs-bots; phase 2 is HL2-style netcode over WebRTC.

## Stack (locked)
- **TypeScript · React 19 · React Three Fiber v9 (+ drei) · Vite · Express**,
  zustand for UI↔canvas state. Matches the sibling repos (Horde, Billet, Banner,
  Stargazer-Raiders); tech is copied/adapted from them — never linked.
- Relative imports carry explicit `.ts`/`.tsx` extensions (node --test runs the
  sim sources directly; Banner convention).
- COOP/COEP headers from day one.

## The non-negotiable rule
**The worker (`src/sim.worker.ts` → `src/sim/world.ts`) owns ALL game state. The
main thread renders and predicts only.** All player intent — human input, bot
output, someday remote peers — flows through the `UserCmd` shape (`protocol.ts`).
The sim never reads input devices or the wall clock.

**First-person wrinkle:** the camera can't tolerate worker latency, so
`scene/PlayerRig.tsx` runs a prediction shim that integrates the SAME movement
function locally and reconciles toward each worker frame. The shared integrator is
**`src/sim/movement.ts`** — the worker and the shim both call it; never fork it.
Camera rotation is render-only; the yaw/pitch on a cmd is aim, an input.

## The netcode seams (phase 2 is transport-only; do not break these)
HL2-style host-authoritative snapshots over WebRTC unreliable DataChannels — NOT
lockstep. What that requires of today's code:
1. `protocol.ts` defines `UserCmd` (~10 B quantized) and the `Snapshot` shape.
2. `sim/types.ts` splits **replicated** (`*Core`) from **host-only** (BotState,
   DropDirector, RNGs) state. New fields go on the correct side.
3. `sim/movement.ts` stays pure `(state, input, dt, boxes)` — it IS the future
   client-side prediction code.
4. Seeded RNG streams only (`math.ts makePrng/deriveSeed`) — not for cross-machine
   sync (snapshots make desync impossible) but for reproducible tests/replays;
   `test/replay.test.ts` enforces it. No `Math.random` in sim scope.
5. Movers are pure functions of tick (`maps/types.ts updateMovers`) so clients can
   render them without replication.

## Other invariants
- `src/config.ts` is the single source of truth for tuning (knockback formula
  constants, weapon table, AI tiers, strides). No magic numbers in loops.
- Per-frame sim data never enters React state; throttled human-rate values only in
  zustand (`simClient.ts` throttle). Renderers read frames imperatively in
  `useFrame` (fixed pools, instanced or pooled meshes — never one element per
  entity per frame).
- The worker never reads a buffer after transferring it; `pack()` allocates fresh.
- Sim step ORDER (world.ts `step()`: cmds → fire → projectiles → bodies → pickups
  → deaths → respawns → hit bookkeeping → round) is a contract the tests lean on.
- Maps are plain data (`sim/maps/*.ts`, `MapDef`). Geometry edits are data edits.
- Bots are parameter rows (`AI_TIERS`), never separate code paths; they emit
  `UserCmd`s through the same seam as humans (`sim/ai/bot.ts`).

## Commands
- `npm run dev` — Vite + HMR at :5181 (COOP/COEP set)
- `npm test` — headless sim tests (node --test, no browser)
- `npm run lint` — `tsc --noEmit`
- `npm run build` — lint + vite build → `dist/`
- `npm run serve` — Express serves dist at :3011
- Browser probes (dev): `window.__mbCmd(msg)` posts raw worker commands,
  `window.__mbProbe()` reads the latest frame, `window.__mbCam` camera state.

## Layout
```
src/config.ts          CFG/TUNING/WEAPONS/AI_TIERS/STRIDE — all tuning
src/math.ts            seeded PRNG streams, deriveSeed, hash helpers (from Horde)
src/protocol.ts        UserCmd/Snapshot/MatchSettings — the netcode contract
src/sim/world.ts       THE SIM: players, round state machine, step order, pack()
src/sim/movement.ts    shared body integrator (worker AND prediction shim)
src/sim/collision.ts   circle-vs-AABB, ground/ceiling, ray vs box/capsule
src/sim/combat.ts      knockback formula, applyHit/applySplash, aimDir
src/sim/weapons.ts     fire logic: rocket/saber/sniper/nuke
src/sim/projectiles.ts swept rocket/nuke flight + explosions
src/sim/pickups.ts     sky-drop director + falling items + collection
src/sim/modes.ts       LMS / Masters-vs-Blasters / Timed as ModeRules
src/sim/ai/bot.ts      fight/collect/edgeGuard/recover; tiers = parameters
src/sim/maps/          MapDef schema + testArena, moontop, crusher, quake, hyrule
src/sim.worker.ts      fixed-tick scheduler + command queue ONLY
src/simClient.ts       frames, interpolation getters, event routing, cmd senders
src/store.ts           zustand: menu settings, HUD mirrors, feed, banner
src/scene/             Scene, MapMesh, PlayerRig (FP/TP + shim), Players,
                       Viewmodel, Projectiles, Pickups, Effects, FpsMeter, shake
src/ui/                Hud, Menu, Scoreboard, RoundOverlay
test/                  movement, knockback, weapons, rounds, bots, replay
```

## When adding features
1. Sim change → `src/sim/` (+ maybe a `Command`/`SimEvent` variant). Movement
   changes go in `movement.ts` so worker and shim stay in sync.
2. New replicated state → the `*Core` structs + `pack()` + `STRIDE` + the consuming
   renderer, together.
3. New tunable → `config.ts`. New UI value → throttle through `store.ts`.
4. Run `npm run lint && npm test` before calling anything done. For visual changes,
   drive the real game (playwright + the `__mb*` probes) and LOOK at a screenshot.
5. M2-style feel gates matter: knockback/jetpack tuning changes need a human hand
   on the keys, not just green tests.

## Style
ES modules, semicolons, 2-space indent. Comments explain *why*, not *what*. Keep
hot loops (per-player step, projectile sweeps, useFrame writes) allocation-light.
