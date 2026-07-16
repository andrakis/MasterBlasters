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

## Phase 2 — multiplayer (design in TECH §3; seams already in place)

1. Snapshot codec: quantize + delta the `*Core` structs; codec round-trip test
2. Signaling route on `server/index.js` (rooms, SDP/ICE relay)
3. Two DataChannels per peer; host loop feeding remote cmds into `World`
4. Client: prediction replay ring + 100 ms interpolation buffers
5. Host-side lag compensation for the sniper
6. Lobby UI (host/join, room codes), host migration (later)

## Phase 2.5 — polish

- Audio (`src/audio.ts` stubs at the event-drain sites first)
- Real character models/animation; saber trail; nuke mushroom
- Spectator camera after elimination; match stats screen
- More original maps: mb_columns, mb_egyptarena, mb_outpost, mb_pirates
