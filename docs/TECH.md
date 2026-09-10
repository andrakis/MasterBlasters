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


## 8. The rules VM (CoreFrame)

Scoring is not computed in TypeScript. `src/rules/mb_rules_core.c` is a resident process
in the CoreFrame VM — the c4bb simulator of the c4m ISA, vendored under `vendor/coreframe/`
and booted in `sim.worker.ts` beside the World from `public/coreframe/{microcode.uc, fw.c4r,
mb_rules.c4r}`. The World sends frames (`src/rules/frames.json`: MATCH_START, ROUND_START,
FALL, SPAWN, TIMER, TICK_END) through a shared-RAM mailbox and adopts the VERDICT replies:
stream seeds, spawn slots, KO credit, stocks, round results, sudden death, match wins.
Calls are synchronous and event-rate (a handful per round, ~1k guest cycles each).

Why: a copied bundle cannot score a round without the image, and the same image replays
on a server — `tools/verify-round.mjs` re-runs a client's frame log (`window.__mbRoundLog()`)
on the node host and, with `--native`, under native c4m32 (`test/fixtures/mb_rules_native.c4r`,
the same core through a file log). `test/rulesParity.test.ts` pins both hosts identical.
Rebuild after editing the C: `tools/build-rules.sh` (needs ../CoreFrame and ~/git/c4).

## 9. The C4KE console (DEV builds and `?debug`)
In a dev build the rules VM boots **under C4KE** instead of bare: the vendored kernel host
loads `public/coreframe/kernel/c4ke32.c4r` and its binaries-only disk (`init`, `c4sh`,
`c4ke.vfs`, `vfsload`, `top`, `ps`, and `mb_rules_k.c4r` — the same rules unit linked with
`cf_kmain.c`, the kernel's mailbox opcodes — all permuted and signed like the rest), starts
`mb_rules_k.c4r &` as a background job and `top -d 5000 &` at the shell. The sim worker
gives the OS a slice each tick (`rules.breathe(50000)`, cheap when it is idle) and relays
what the kernel prints; **tilde** drops a Quake-style console over the game
(`src/ui/Console.tsx`) where you watch top refresh every 5 s of real time and type at
c4sh (`ps`, `top -d 1000 &`, `kill`, …). While it is open the game's keys and pointer lock
stand aside; tilde or Escape closes it. Release builds stay bare and attested; the replay
verifier (`verify-round`) is bare too, and the gate proves a round played under the kernel
verifies against it — the verdicts are the same unit's (`test/kernelParity.test.ts` pins
bare == kernel reply for reply). Not cycle-deterministic (the kernel's clock follows real
time here), which the release path does not need. The kernel host wakes the module by the
scheduler's scan, not an interrupt: an interrupt landing while `top` is woken wedges C4KE
(CoreFrame docs/messaging.md).
Gate: `tools/vm-gate.mjs` opens the console with a real tilde, sees top's rows and the rules
task, types `ps`, closes it.

