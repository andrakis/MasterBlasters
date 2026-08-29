# Asset recovery from the 2007 HL2 mod

Source: `~/git/masterblasters_hl2` — the shipped mod tree (GameInfo.txt, 6 compiled
BSPs, materials, models, sound). Goal: recover **geometry, texturing and lighting**
for the Three.js remake. Original scripting is deliberately NOT recovered — it is
rebuilt natively (see ROADMAP Phase 2.5).

Guiding call: we do **not** reimplement a Source renderer. Everything Source baked
at compile time (lightmaps, texture vectors) is *replayed* as ordinary Three.js
data — a texture atlas and a second UV set. Everything Source did at runtime is
either dropped or rewritten in our own sim.

## Survey findings (2026-08-29)

BSPs are VBSP v20 (Orange Box). All brush/plane/side lumps intact; 2078 brushes
across 5 maps parsed with **zero degenerate hulls**.

| map | brushes | axis-aligned | extent (units) | brush ents |
|---|---|---|---|---|
| mb_columns | 189 | **100%** | 4096 x 4096 | 5 |
| mb_quake | 235 | 77% | 5120 x 6144 | 5 |
| mb_outpost | 115 | 67% | 8524 x 5012 | 5 (+water) |
| mb_pirates | 804 | 22% | - | 115 |
| mb_egyptarena | 735 | 16% | - | 5 |

mb_columns uses only **13 materials**, all present as VMT+VTF, all
`LightmappedGeneric` with a single `$basetexture`. VTFs are v7.2, DXT1 (DXT5 where
alpha is needed). Lighting lump is LDR (`ColorRGBExp32`), 1626 faces.

## M-A0 — Toolchain (`tools/bsp/`)
- [x] `lib/bsp.mjs` — lump reader: planes, brushes, brushsides, texinfo, texdata,
      entities, models, faces, verts, edges, surfedges, lighting
- [x] `lib/vtf.mjs` — VTF v7.x decode: DXT1/DXT3/DXT5 + uncompressed formats
- [x] `lib/vmt.mjs` — VMT key/value parse, `$basetexture` resolution
- [x] `lib/png.mjs` — dependency-free PNG encoder (node:zlib)
- [x] `extract.mjs` — CLI: BSP + materials root -> scene.json + textures + lightmap

## M-A1 — Geometry + texturing (mb_columns first)
- [x] Brush hulls -> convex volumes; contents flags split SOLID / DETAIL / CLIP / WATER
- [x] BSP **faces** -> triangles with real UVs from texinfo `textureVecs` (fidelity path)
- [x] TOOLS/* materials excluded from render, retained for collision/bounds
- [x] Textures decoded to PNG, referenced by scene.json

## M-A2 — Lighting without a Source renderer
- [x] Per-face lightmap samples -> packed atlas, `uv2` channel
- [x] Three.js `MeshBasicMaterial` + `lightMap` replays the 2007 bake
- [x] `light` / `light_environment` entities exported in scene.json
- [x] **Theme derivation** — `bsp2mapdef` reads the map's own lights + mean texdata
      reflectivity to emit the `MapDef.theme` palette, instead of hand-picking

## M-A3 — Viewer
- [x] `bspview.html` Vite entry, isolated from the game bundle
- [x] Fly camera; toggles: textures / lightmap / brush volumes / MapDef boxes

## M-A4 — MapDef conversion (the game path)
- [x] `bsp2mapdef.mjs`: brushes -> `{x,y,z,w,h,d}`, `info_player_deathmatch` ->
      spawnPoints, `env_entity_maker` -> pickupSpots, `trigger_hurt` -> kill plane
- [x] **Scale calibration** — 1 unit = 1 inch lands mb_columns at a 36x27 m
      playfield, right on the existing arenas' scale. No fudge factor needed.
      Superseded the open design call below.
- [ ] ~~rescale vs faithful-and-bigger~~ RESOLVED: faithful is already correct — originals are 4096-8524 units across vs the remake's
      ~48 m arenas. Calibrate off the 72-unit player capsule; decide rescale vs
      faithful-and-bigger. OPEN DESIGN CALL.
- [x] mb_columns lands as a playable `MapDef` (wired into MAP_LIST; **unplaytested**)

## M-A5 — Sound (cheapest win)
- [ ] 40 files: 9 WAV (PCM 44.1k) + 31 MP3 — browser-native, no conversion
- [ ] Wire to the existing `src/audio.ts` event-drain stubs

## M-A6 — Models — DEFERRED
`.mdl`+`.vvd`+`.vtx` is three interlocking formats with bone weights and LOD strip
groups: days of work, not hours. Worse, most of what is here is **stock Valve**
content (police.mdl, w_Pistol, v_crowbar, male_01), not mod-original — only
`ctf_weapons/{v,w}_sniper` look custom. Low value, high cost, licensing questions.
Not scheduled.

## Licensing note
Mod-original art (the EGYPTSOC_* texture sets, custom sounds) is the mod team's own.
Stock Valve assets in this tree (TOOLS/*, HALFLIFE/BLACK, PROPS/WOODCRATE003D, the
HL2 models) are Valve's and should not ship in a public build. The extractor flags
material provenance so this stays a deliberate choice.


## Results (2026-08-29)

`node tools/bsp/extract.mjs <bsp> --out public/maps/<id>` and
`node tools/bsp/bsp2mapdef.mjs <bsp> --out src/sim/maps/<id>.ts --json <dir>/mapdef.json`.

mb_columns, end to end:
- 1626 faces -> **3816 tris in 12 groups**; 10 materials, all 8 mod-original ones
  resolved from VMT+VTF. The 2 that miss are stock Valve (`HALFLIFE/BLACK`,
  `PROPS/WOODCRATE003D`) and render as flat void by design.
- Lightmap: **1598/1626 faces lit**, packed to a 1024x1024 atlas on `uv1`.
  Stored gamma-encoded + tagged sRGB, so three.js decodes back to the same linear
  value VRAD baked — correct by round-trip, not by eyeballing.
- MapDef: **153 platforms, 0 squared off** (mb_columns is 100% axis-aligned),
  8 spawns, 11 pickup spots, `killY: -12.04` recovered from the thin `trigger_hurt`
  slab rather than the map-sized sealing volume.
- Verified: MapDef boxes overlaid on the original faces in the viewer line up;
  all 8 spawns face the arena centre (inward dot = 1.00) and none intersect a solid;
  `npm run lint` clean, `npm test` 43/43, game loads the map at 59-60 tps.

### Things the BSP told us that memory could not
- **mb_columns is cyan-lit.** 120 x `light "86 225 233 350"`. The EGYPTSOC sandstone
  texture set suggests warm; the bake is teal. The theme is derived from this.
- The kill plane sits **12.04 m** below the deck.
- `env_entity_maker` x11 at ~48 m up is the original sky-drop director — the same
  mechanic the remake already has, at the original's coordinates.

### Known gaps
- Displacements (`dispinfo >= 0`) are skipped; mb_columns has none, but
  mb_egyptarena / mb_pirates will need the DISPINFO lump.
- `func_*` brush entities are grouped by model but not animated — mb_pirates'
  24 `func_tracktrain` / 12 `func_door_rotating` need hand-authored `mover` defs.
- ~~spawn yaw not applied~~ FIXED, see below.

## Playability pass (2026-08-29)

mb_columns is playable solo. `test/recoveredMaps.test.ts` asserts the things that
make a recovered map playable rather than eyeballing them: every spawn lands on
solid ground within 3 m, no spawn is buried in geometry, walking off a deck reaches
the void, `killY` sits below every deck, spawns face the arena, and pickups fall
from above the decks.

Three real bugs fixed on the way:

1. **Spawn yaw was clobbered every tick.** `world.ts` applied `NEUTRAL_CMD` when a
   human player had sent no input, and `NEUTRAL_CMD.yaw` is 0 — so `respawn()`'s
   `p.yaw = best.yaw` survived exactly zero ticks and every idle player snapped to
   face -Z. Now look only moves when there is real input (bot or human). This was a
   pre-existing sim bug; it only became visible because the recovered spawns are the
   first ones whose facing actually matters.
2. **The prediction shim never adopted the spawn facing.** It owns look direction
   and started at yaw 0 regardless. It now adopts the sim's yaw once per life.
   `AuthLocal` carries `yaw` for this.
3. **The yaw conversion formula was wrong.** It was derived from `crusher.ts`'s
   spawn table, which disagrees with the engine. The authority is `aimDir()` in
   `sim/combat.ts`: forward is `(-sin yaw, -cos yaw)`, so yaw 0 faces **-Z**.
   Correct conversion is `yaw = sourceYaw - 90 deg`.
   *Note for later:* `crusher.ts`'s z-axis spawns (`z: 4, yaw: PI` and
   `z: -4, yaw: 0`) face outward under `aimDir`. Hand-authored data, left alone.

### Placeholder policy
`tools/bsp/lib/placeholder.mjs`. Two cases, two answers:
- **void** — `HALFLIFE/BLACK` is a Valve material that is literally flat black.
  Regenerating "black" is not shipping Valve's asset, so this is a correct
  reimplementation and it renders unlit and pure black.
- **placeholder** — anything else we cannot ship gets magenta/black checks with a
  yellow diagonal, rendered unlit so it stays loud. A silent black surface reads as
  a rendering bug; it did, and it cost a debugging round.

Currently only `PROPS/WOODCRATE003D` (3 `func_physbox` crates) takes a placeholder.

### Why the columns go black — NOT a bug
All 120 `light` entities sit between y = 8.9 m and 15 m, with `_quadratic_attn 1`.
The column shafts are textured over their full -16..62 m span but receive no light
outside that band:

| column height | mean linear luxel |
|---|---|
| 0..24 m | 120-200 |
| 24..32 m | 18 |
| 40..64 m | 2-5 |
| -16..0 m | 4-8 |

That is the original 2007 look: the arena floats in a lit band and the columns
recede into the void. Only affects the fidelity viewer — the game re-lights.
