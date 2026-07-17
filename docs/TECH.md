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

## §3 Netcode (LIVE — HL2/Source-style replication, not lockstep)

Desync is structurally impossible because clients never simulate the world. One
player hosts; their worker runs the only `World`.

- **Topology:** signaling over a same-origin `/signal` WebSocket
  (`server/signaling.js`, attached to both Vite dev and the Express prod server —
  rooms with 4-letter codes, SDP/ICE relay). Per peer, the host offers an
  RTCPeerConnection with TWO DataChannels: `fast` (`ordered:false,
  maxRetransmits:0` — the browser's UDP) for cmds up / snapshots down, and `ord`
  (reliable) for handshake, roster, match start, `SimEvent`s, pings.
- **Upstream:** every render frame the client sends a 10-byte quantized `UserCmd`
  (`protocol.ts encodeCmd`). The host stamps it with the peer's slot and queues it
  into the worker — bots, the host's own input, and remote peers all enter the sim
  through the identical seam.
- **Downstream:** every `SNAP_EVERY` (3) ticks the host encodes the worker frame
  with `encodeSnapshot` — 13 B header + 30 B/player + 15 B/projectile + 9 B/pickup,
  positions i16 @ 1/64 m — and fans the same buffer to every peer. Measured in the
  two-browser test: **~2-3 KB/s per client**. Full state every snapshot: loss needs
  no ack bookkeeping (delta masks remain a future optimization).
- **Client prediction:** `PlayerRig` rebases on each snapshot to the authoritative
  body, then replays every unacked cmd (ack = `lastCmdSeq` echoed in the player
  record, wrap-aware) through the SAME `sim/movement.ts` integrator, and keeps
  integrating live input between snapshots. Rebase error decays through a
  render-only smoothing offset (~80 ms).
- **Interpolation:** remote entities lerp between the two retained frames (3-tick
  spans at 20 Hz); projectiles extrapolate ballistically; movers replicate nothing
  (pure functions of tick).
- **Lag compensation:** the host pings each peer on `ord` (2 s cadence), converts
  RTT/2 + INTERP_MS into `lagTicks`, and the sim rewinds hitscan capsules through
  a 64-tick position history (`world.rewindPos`) — you hit what you aimed at.
- **Client frames:** `simClient.frameFromSnapshot` rebuilds the exact `Frame` shape
  the renderer already consumes (scores and HUD derived from the player records) —
  the scene graph and HUD have no idea the worker is remote.

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
