// Textured world geometry recovered from the original 2007 BSP.
//
// This renders ONLY. Collision stays on the MapDef boxes the sim owns — the two
// are separate on purpose, and tools/bsp/extract.mjs emits this geometry in the
// same playfield space as the MapDef so they cannot drift apart.
//
// The 2007 VRAD lightmap comes along as a texture atlas on the `uv1` channel, so
// these surfaces need no scene lighting at all; MeshBasicMaterial replays the
// original bake exactly.

import { useEffect, useState } from 'react';
import * as THREE from 'three';

type SceneMaterial = {
  name: string; file: string | null; width: number; height: number;
  transparent: boolean; tool: boolean; missing: boolean;
  kind?: 'texture' | 'void' | 'placeholder';
};
type SceneGroup = { model: number; material: number; pos: number[]; normal: number[]; uv: number[]; uv2: number[]; idx: number[] };
type BspScene = {
  map: string;
  lightmap: { file: string; width: number; height: number };
  materials: SceneMaterial[];
  groups: SceneGroup[];
};

const cache = new Map<string, Promise<BspScene | null>>();

function load(mapId: string): Promise<BspScene | null> {
  let p = cache.get(mapId);
  if (!p) {
    // Hand-authored maps have no scene.json and keep their boxes. Check the
    // content type explicitly: the dev server answers unknown paths with
    // index.html and a 200, so `r.ok` alone is not enough.
    p = fetch(`/maps/${mapId}/scene.json`)
      .then((r) => {
        if (!r.ok) return null;
        if (!/application\/json/i.test(r.headers.get('content-type') ?? '')) return null;
        return r.json();
      })
      .catch(() => null);
    cache.set(mapId, p);
  }
  return p;
}

export function BspWorld({ mapId, onLoaded }: { mapId: string; onLoaded?: (ok: boolean) => void }) {
  const [root, setRoot] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let alive = true;
    let built: { group: THREE.Group; dispose: () => void } | null = null;

    load(mapId).then((scene) => {
      if (!alive) return;
      if (!scene) { onLoaded?.(false); return; }
      built = build(scene, `/maps/${mapId}`);
      setRoot(built.group);
      onLoaded?.(true);
    });

    return () => {
      alive = false;
      built?.dispose();
      setRoot(null);
    };
  }, [mapId, onLoaded]);

  return root ? <primitive object={root} /> : null;
}

function build(scene: BspScene, base: string) {
  const loader = new THREE.TextureLoader();
  const lightmap = loader.load(`${base}/${scene.lightmap.file}`);
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lightmap.minFilter = THREE.LinearFilter;
  lightmap.magFilter = THREE.LinearFilter;
  lightmap.generateMipmaps = false;

  const materials = scene.materials.map((m) => {
    const map = m.file ? loader.load(`${base}/${m.file}`) : null;
    if (map) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
    }
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: m.transparent,
      alphaTest: m.transparent ? 0.5 : 0,
      // the void seal and placeholders take no bake — the first IS the void, the
      // second must stay obviously wrong rather than fade into a dark corner
      lightMap: m.kind === 'void' || m.kind === 'placeholder' ? null : lightmap,
      // the 2007 bake is dark by design (mb_columns lights only a 6 m band), so
      // lift it to something playable rather than faithful-but-unreadable
      lightMapIntensity: 2.2,
    });
    mat.name = m.name;
    return mat;
  });

  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (const g of scene.groups) {
    // The game draws its own sky dome; the BSP's black world-seal would just
    // box it in, so drop those faces here rather than at extract time (the
    // viewer still wants them).
    if (scene.materials[g.material]?.kind === 'void') continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(g.uv2, 2)); // lightMap channel
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[g.material]);
    mesh.name = `bsp:${scene.materials[g.material]?.name ?? g.material}`;
    group.add(mesh);
    meshes.push(mesh);
  }

  return {
    group,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) { m.map?.dispose(); m.dispose(); }
      lightmap.dispose();
    },
  };
}
