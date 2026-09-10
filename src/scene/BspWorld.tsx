// Textured world geometry recovered from the original 2007 BSP.
//
// This renders ONLY. Collision stays on the MapDef boxes the sim owns — the two
// are separate on purpose, and tools/bsp/extract.mjs emits this geometry in the
// same playfield space as the MapDef so they cannot drift apart.
//
// The 2007 VRAD lightmap comes along as a texture atlas on the `uv1` channel, so
// these surfaces need no scene lighting at all; MeshBasicMaterial replays the
// original bake exactly.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type SceneMaterial = {
  name: string; file: string | null; width: number; height: number;
  transparent: boolean; tool: boolean; missing: boolean;
  kind?: 'texture' | 'void' | 'placeholder' | 'cc0' | 'generated';
};
type SceneGroup = { model: number; material: number; pos: number[]; normal: number[]; uv: number[]; uv2: number[]; idx: number[] };
type BspScene = {
  map: string;
  lightmap: { file: string; width: number; height: number };
  materials: SceneMaterial[];
  groups: SceneGroup[];
  /** the 3D skybox, relative to the map's sky_camera and already scaled; null or absent when the map has none */
  sky?: { scale: number; radius: number; groups: SceneGroup[] } | null;
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
  const sky = useRef<{ group: THREE.Group; radius: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let built: { group: THREE.Group; sky: { group: THREE.Group; radius: number } | null; dispose: () => void } | null = null;

    load(mapId).then((scene) => {
      if (!alive) return;
      if (!scene) { onLoaded?.(false); return; }
      built = build(scene, `/maps/${mapId}`);
      sky.current = built.sky;
      setRoot(built.group);
      onLoaded?.(true);
    });

    return () => {
      alive = false;
      sky.current = null;
      built?.dispose();
      setRoot(null);
    };
  }, [mapId, onLoaded]);

  // The 3D skybox rides the eye: what you see of it is only its directions, so anchoring it
  // on the camera gives the parallax of something a kilometre away, and a uniform scale about
  // that anchor changes nothing on screen -- which is how it fits inside a 500 m far plane.
  useFrame(({ camera }) => {
    const s = sky.current;
    if (!s) return;
    s.group.position.copy(camera.position);
    const far = (camera as THREE.PerspectiveCamera).far ?? 500;
    s.group.scale.setScalar(s.radius > 0 ? Math.min(1, (far * 0.9) / s.radius) : 1);
  });

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
    // shared CC0 / generated stand-ins live at a repo-absolute path
    const map = m.file ? loader.load(m.file.startsWith('/') ? m.file : `${base}/${m.file}`) : null;
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

  // ---- the 3D skybox ---------------------------------------------------------------------
  // Drawn first with no depth at all, so the world always paints over it and it can never
  // occlude the arena however near a piece of it lands. Its triangles were sorted
  // back-to-front from the anchor at extract time, which is what makes that safe.
  let sky: { group: THREE.Group; radius: number } | null = null;
  const skyMeshes: THREE.Mesh[] = [];
  const skyMats: THREE.Material[] = [];
  if (scene.sky?.groups?.length) {
    const g0 = new THREE.Group();
    g0.name = 'skybox';
    g0.renderOrder = -1000;
    for (const g of scene.sky.groups) {
      if (scene.materials[g.material]?.kind === 'void') continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('uv1', new THREE.Float32BufferAttribute(g.uv2, 2));
      geo.setIndex(g.idx);
      const mat = (materials[g.material] as THREE.MeshBasicMaterial).clone();
      mat.depthTest = false;
      mat.depthWrite = false;
      // a backdrop is not in the world's weather: the scene fogs out at 160 m and this
      // sits at hundreds, so the world's fog would swallow it whole. Source fogs the
      // skybox with the sky_camera's own settings, which this map disables.
      mat.fog = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `sky:${scene.materials[g.material]?.name ?? g.material}`;
      mesh.renderOrder = -1000;
      mesh.frustumCulled = false;
      g0.add(mesh);
      skyMeshes.push(mesh);
      skyMats.push(mat);
    }
    group.add(g0);
    sky = { group: g0, radius: scene.sky.radius ?? 0 };
  }

  return {
    group,
    sky,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of skyMeshes) m.geometry.dispose();
      for (const m of skyMats) m.dispose();
      for (const m of materials) { m.map?.dispose(); m.dispose(); }
      lightmap.dispose();
    },
  };
}
