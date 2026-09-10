# MASTER BLASTERS — Roadmap

## Done (v1: bots + all modes + all maps)

- **M0 Scaffold** — Vite/TS/R3F template, worker ticking, Express server
- **M1 Walk the arena** — movement/collision integrator, test arena, FP camera,
  killY → stock → respawn
- **M2 Rockets & knockback** — knockback formula, jetpack, rocket jumping,
  HUD meters *(feel gate: tuning constants live in config.ts — revisit with hands
  on keys)*
- **M3 Bots & LMS** — three AI tiers, round loop, menu, scoreboard, kill feed
- **M4 Full arsenal & sky drops** — saber (jet drain), sniper (hitscan +
  edge-guarding), mini nuke (lob), drop director, quad
- **M5 Teams & Timed** — Masters vs Blasters, timed + sudden death
- **M6 Cameras & characters** — TP toggle w/ occlusion, cowboy/ninja bodies,
  FOV punch, camera shake, vignette
- **M7 Maps** — moontop (low-g), crusher (movers), quake, hyrule
- **M8 Tests & docs** — 35 headless tests, replay fingerprint, browser drive

## Feel-gate backlog (needs a human hand, in menu order of likelihood)

- Knockback scale (`KB_*`) vs platform sizes — does a 60% hp victim feel doomed?
- Jetpack economy (`JET_*`) — is recovery too easy from below the deck?
- Rocket speed 28 m/s vs strafe speed 9 — dodgeable at mid-range?
- Bot Gunslinger difficulty as the default sparring partner
- Crusher sweeper speeds; moontop gravity 0.55

## Phase 2 — multiplayer (SHIPPED; details in TECH §3)

- ✔ Binary snapshot codec (30 B/player @ 20 Hz ≈ 2-3 KB/s measured) + round-trip tests
- ✔ Signaling: `/signal` WS on Vite dev AND Express prod (rooms, 4-letter codes)
- ✔ Two DataChannels per peer; peer cmds + RTT-derived lag ticks fed into the worker
- ✔ Client prediction replay ring over the shared integrator + rebase smoothing
- ✔ Host-side lag-compensated sniper (64-tick position history rewind)
- ✔ Lobby UI: host/join by code, live roster, host-started matches, rematch from lobby
- Verified end-to-end: two headless browsers over real WebRTC — client input moves
  the player in the host's sim, projectiles/scores/kill-feed sync, zero errors

### Phase 2 backlog
- Host migration when the host leaves (today: everyone returns to the menu)
- Delta-compressed snapshots vs last-acked (bandwidth is already comfortable)
- Mid-match joiners spawn into the round (today they spectate until a rematch)
- Removing a disconnected peer's body from the round (today it idles until KO'd)

## Phase 2.5 — polish

- Audio (`src/audio.ts` stubs at the event-drain sites first)
- Real character models/animation; saber trail; nuke mushroom
- Spectator camera after elimination; match stats screen
- More original maps: mb_columns, mb_egyptarena, mb_outpost, mb_pirates

## The 3D skybox (2026-09-10, user request)
egyptarena's dramatic banks and sea are its **3D skybox**: 146 of the map's 288 displacement
grids, built at 1/16 scale near a `sky_camera` and drawn by the engine scaled up around the
player. `extract.mjs` dropped them (a miniature drawn in place rings the level with wrongly
sized terrain), so the recovered map has only the playable terrain — which really is mostly
flat (100 of its 142 grids are flat in the BSP too).
- [x] `extract.mjs`: emit the skybox as its own `sky: { scale, radius, groups }` in scene.json,
  vertices RELATIVE to the sky camera and multiplied by `sky_camera.scale`, so a renderer only
  has to keep the group on the camera. Triangles sorted back-to-front from the anchor at build
  time (on the rounded values the file stores, so the order in it is exact), so painter's order is right from every angle without a depth pass — egyptarena 169 faces/77k tris/radius 1578 m, outpost 141 faces/33k tris
- [x] Fix the normal transform while there: the source→three conversion's playfield SHIFT was
  being applied to normals as well as positions, which points every normal the same way
- [x] Renderers anchor it: `editor/src/viewport/reference.ts` + the viewport's frame loop, and
  the game's `BspWorld.tsx`; materials depthTest/depthWrite off at renderOrder -1000, so the
  world always paints over it and it can never occlude the arena; fog off (the scene fogs out at 160 m) and the game's dome moved to -2000 so it stays behind
- [x] Re-extracted egyptarena and outpost (the two with a sky_camera) plus columns; egyptarena's scene.json 5.0 -> 9.5 MB
- [x] Verified: the editor's waterline view shows the sea and hills as the 2007 screenshot does; in the game 157k triangles drawn against 79k with the backdrop hidden; `test/skybox.test.ts`

## Open source, and the VM that came out (2026-09-10)
This game was CoreFrame's proof of concept: its scoring ran inside a signed c4 image for a
while, and it proved the whole platform — native parity, server replay, permuted and signed
images, in-VM attestation, a C4KE console. It is being released open source, and **a public
game has nothing to protect**: its rules are readable either way, so the moat bought it
nothing and the 7 MB of vendored machine was weight. Scoring is plain TypeScript again
(`sim/world.ts` + `sim/modes.ts` + `math.ts deriveSeed`, restored verbatim from the commit
that took them out). The integration is kept whole at
`CoreFrame/projects/masterblasters/vm-integration/` and can be reapplied with one `git apply`.
What stayed, because it is this game's own work: the BSP recovery pipeline, the four recovered
2007 maps, the 3D skybox, `?map=`, and a browser gate of its own (`npm run gate`).

