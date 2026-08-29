# Source asset recovery

> Shared codecs (VTF, VMT, PNG, MDL) live in `tools/lib/`. Model extraction is
> `tools/mdl/`; this directory is the map pipeline.

Extracts geometry, texturing and baked lighting from the 2007 Half-Life 2 mod's
compiled maps (`~/git/masterblasters_hl2`). See `docs/ASSET-RECOVERY.md`.

No dependencies — the VTF decoder, VMT parser and PNG encoder are all in `lib/`.
Nothing here runs as part of the build; regenerating is a deliberate act and the
outputs are checked in.

## Two paths, on purpose

**Fidelity** — `extract.mjs` reads the compiled *faces* with their real texture
vectors and lightmap UVs. This is what the viewer shows: the map as it looked.

```
node tools/bsp/extract.mjs ~/git/masterblasters_hl2/maps/mb_columns.bsp \
  --out public/maps/mb_columns
```

**Game** — `bsp2mapdef.mjs` reads the designer's original *brushes* and squares
each to its AABB, because the sim collides against boxes. Lossy by design; angled
brushes are flagged `approx` so they can be hand-fixed rather than silently
squashed.

```
node tools/bsp/bsp2mapdef.mjs ~/git/masterblasters_hl2/maps/mb_columns.bsp \
  --out src/sim/maps/mbColumns.ts --json public/maps/mb_columns/mapdef.json
```

Flags: `--scale` (default 0.0254, i.e. 1 Hammer unit = 1 inch — verified correct
against the existing arenas), `--max-span` (drop the skybox shell), `--brightness`.

## Viewing

`npm run dev`, then `/bspview.html?map=mb_columns`. Toggle textures, the 2007
lightmap bake, brush volumes, and the converted MapDef boxes overlaid on the
original faces — that overlay is how the conversion gets checked.

## We are not writing a Source renderer

Everything Source baked at compile time is replayed as ordinary three.js data: the
lightmap becomes a texture atlas on a `uv1` channel feeding `MeshBasicMaterial.lightMap`,
gamma-encoded and tagged sRGB so it round-trips to the linear value VRAD computed.
Runtime behaviour (entity I/O, movers, spawners) is *not* ported — the sim owns it.

## Models

```
node tools/mdl/extract.mjs ~/git/masterblasters_hl2/models/police.mdl \
  --out public/models --name ninja
```

Reads MDL + VVD + VTX and emits the **bind pose** — the VVD stores vertices already
posed, so a static mesh needs no bone matrices. View with
`/bspview.html?model=ninja`. Animation is deliberately not ported; the sim owns
motion. See `docs/ASSET-RECOVERY.md` for what these models actually are.

## Capture helpers

`_shot.mjs` (viewer) and `_gameshot.mjs` (the real game) drive headless Chromium
over CDP for screenshots. Underscore-prefixed: dev aids, not part of the pipeline.
