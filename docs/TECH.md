# MASTER BLASTERS — Tech

## §1 Architecture

Worker-sim (Horde template): `src/sim/world.ts` advances in fixed **60 Hz** ticks
inside a Web Worker, consuming a command queue; the main thread renders (R3F) and
predicts. The sim never reads devices or the clock — the worker entry's scheduler
is the only sim-scope code that touches `performance.now()`, deciding how many
ticks to run.

Frames cross the worker boundary as transferable flat `Float32Array`s
(strides in `config.ts STRIDE`) plus a small JSON envelope (round state, HUD
scalars, scoreboard, events). `simClient.ts` retains the last two frames for tick
interpolation and routes `SimEvent`s to the HUD store and the imperative effect
drains.

## §2 First-person prediction

`scene/PlayerRig.tsx` integrates the local body every render frame with the SAME
`sim/movement.ts` integrator the worker runs, then reconciles toward the latest
authoritative frame (rate 12/s; >4 m snaps — respawns). Mouse look is applied to
the camera instantly and travels on the cmd as aim (`yaw`/`pitch`); the sim treats
it as an input like any other. Energy is sim-owned; the shim only predicts the body.

## §3 Netcode model (phase 2 — the seams exist today)

HL2/Source-style replication, **not lockstep** — desync is structurally impossible
because clients never simulate the world:

- **Host-authoritative.** One peer runs this same `World` at 60 Hz.
- **Upstream:** `UserCmd`s at 30 Hz — quantized to ~10 B (protocol.ts documents the
  packing). Bots already occupy the same seam a remote player will.
- **Downstream:** snapshots at 20 Hz, quantized + delta-compressed against the last
  client-acked snapshot (per-entity dirty masks; full snapshot on join/gap). The
  `*Core` structs in `sim/types.ts` are exactly the replicated surface. ~8 players
  ≈ 3–6 KB/s per client.
- **Channels:** one unreliable-unordered WebRTC DataChannel (`ordered:false,
  maxRetransmits:0`) for cmds + snapshots; one reliable-ordered for handshake,
  `SimEvent`s, chat. Signaling: a WS route on `server/index.js`.
- **Client prediction:** own player only — replay unacked cmds through
  `sim/movement.ts` after each snapshot (the v1 shim, plus a cmd ring buffer).
- **Interpolation:** remote entities render 100 ms in the past between buffered
  snapshots; extrapolate ≤50 ms. Movers need nothing: pure functions of tick.
- **Lag compensation:** host keeps ~1 s of positions, rewinds hitscan by the
  shooter's latency+interp.

## §4 Determinism (for tests and replays, not sync)

Seeded PRNG streams per subsystem (`math.ts makePrng/deriveSeed`: drops, AI,
spawns). Same seed + same cmd script ⇒ identical match (`test/replay.test.ts`).
`Math.random` is banned in sim scope; the strict cross-platform transcendental ban
(Horde's dSin/dCos lint) is NOT needed under snapshot netcode and is not enforced.

## §5 Physics

Custom, no engine. Bodies are vertical capsules (circle r=0.45 in XZ over the
feet→head span) vs platform AABBs (`sim/collision.ts`):
ground snap (≤0.35 step), axis pushout walls (sides of platforms too tall to
step), head bump, walk-off-the-edge = losing ground contact. Air control is
Quake-style accelerate — capped along the wish direction, never damping momentum,
so knockback must be answered with the jetpack, not a held key. Projectiles sweep
per tick (ray vs box/capsule) so nothing tunnels.

## §6 Rendering

Fixed pools posed imperatively in `useFrame`: players (interpolated between the two
retained frames), projectiles (velocity-extrapolated), pickups, explosion/tracer
pools. DOM-overlay HUD. Theme-driven sky dome shader + fog per map. TP camera
ray-casts its boom against the platforms and pulls in.

## §7 Testing

`node --test` over the sim sources directly (hence `.ts` import extensions):
movement, knockback formula properties, all four weapons, round/stock/mode logic,
whole headless bot matches (Banner style: outcomes, not internals), and the replay
fingerprint. Browser verification via playwright + `__mbCmd`/`__mbProbe`/`__mbCam`.
