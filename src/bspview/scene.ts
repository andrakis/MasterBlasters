// Turns extract.mjs output into three.js objects. Deliberately dumb: the
// extractor already did the interpretation, this just uploads buffers.
import * as THREE from 'three';

export type SceneMaterial = {
  name: string; file: string | null; width: number; height: number;
  transparent: boolean; tool: boolean; stock: boolean; missing: boolean;
  generated?: boolean; kind?: 'texture' | 'void' | 'placeholder'; shader: string | null;
};
export type SceneGroup = {
  model: number; material: number;
  pos: number[]; normal: number[]; uv: number[]; uv2: number[]; idx: number[];
};
export type SceneBrush = {
  contents: number; solid: boolean; clip: boolean; water: boolean; detail: boolean;
  axisAligned: boolean; min: [number, number, number]; max: [number, number, number];
};
export type SceneEntity = {
  index: number; classname: string; targetname?: string;
  origin: [number, number, number] | null; angles: number[] | null;
  model: string | null; keys: Record<string, string>;
};
export type MapScene = {
  map: string; bspVersion: number; unitsToMeters: number;
  lightmap: { file: string; width: number; height: number; brightness: number };
  materials: SceneMaterial[];
  models: { mins: number[]; maxs: number[]; origin: number[] }[];
  groups: SceneGroup[];
  brushes: SceneBrush[];
  entities: SceneEntity[];
};

export async function loadMapScene(base: string): Promise<MapScene> {
  const res = await fetch(`${base}/scene.json`);
  if (!res.ok) throw new Error(`${base}/scene.json: ${res.status}`);
  return res.json();
}

function texture(url: string, loader: THREE.TextureLoader) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export type BuiltScene = {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
  lightmap: THREE.Texture;
  dispose(): void;
};

export function buildScene(scene: MapScene, base: string): BuiltScene {
  const loader = new THREE.TextureLoader();
  const lightmap = loader.load(`${base}/${scene.lightmap.file}`);
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lightmap.flipY = true;
  lightmap.minFilter = THREE.LinearFilter;
  lightmap.magFilter = THREE.LinearFilter;
  lightmap.generateMipmaps = false;

  const materials = scene.materials.map((m) => {
    const mat = new THREE.MeshBasicMaterial({
      map: m.file ? texture(`${base}/${m.file}`, loader) : null,
      color: 0xffffff,
      transparent: m.transparent,
      alphaTest: m.transparent ? 0.5 : 0,
      side: THREE.FrontSide,
      lightMap: lightmap,
      lightMapIntensity: 1,
    });
    mat.name = m.name;
    // keep the decoded texture reachable so toggling `textures` off and back on
    // does not drop it (setting mat.map = null is otherwise irreversible)
    mat.userData.baseMap = mat.map;
    mat.userData.kind = m.kind ?? 'texture';
    // the void seal takes no light (it IS the void); the placeholder takes none
    // either, so it stays uniformly loud instead of fading into a dark corner
    if (m.kind === 'void' || m.kind === 'placeholder') mat.lightMap = null;
    return mat;
  });

  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (const g of scene.groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    // three.js r152+ reads the lightMap from the `uv1` attribute
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(g.uv2, 2));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[g.material]);
    mesh.name = `${scene.materials[g.material].name}#model${g.model}`;
    mesh.userData.model = g.model;
    root.add(mesh);
    meshes.push(mesh);
  }

  return {
    root, meshes, materials, lightmap,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) { m.map?.dispose(); m.dispose(); }
      lightmap.dispose();
    },
  };
}

/** Wireframe boxes for the designer's original brush volumes. */
export function buildBrushBoxes(scene: MapScene) {
  const group = new THREE.Group();
  const colors = { solid: 0x66ccff, clip: 0xff4488, water: 0x44ffcc, detail: 0x8888ff };
  for (const b of scene.brushes) {
    const size = [0, 1, 2].map((a) => Math.max(1e-3, b.max[a] - b.min[a])) as [number, number, number];
    const kind = b.clip ? 'clip' : b.water ? 'water' : b.detail ? 'detail' : 'solid';
    const box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    const helper = new THREE.Box3Helper(box, colors[kind]);
    helper.userData.kind = kind;
    helper.userData.axisAligned = b.axisAligned;
    group.add(helper);
    void size;
  }
  return group;
}

/** The converted MapDef collision boxes, for overlaying on the original faces. */
export type MapDefJson = {
  id: string;
  platforms: { x: number; y: number; z: number; w: number; h: number; d: number; approx?: boolean }[];
  spawnPoints: { x: number; y: number; z: number; yaw: number }[];
  pickupSpots: { x: number; y: number; z: number }[];
  killY: number;
};

/**
 * MapDef boxes are emitted in *playfield* space (recentred on the spawn cluster),
 * while the faces are in raw world space. `offset` re-aligns them.
 */
export function buildMapDefBoxes(md: MapDefJson, offset: [number, number, number]) {
  const group = new THREE.Group();
  const solid = new THREE.MeshBasicMaterial({ color: 0xff8844, wireframe: true, transparent: true, opacity: 0.55 });
  const approx = new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true, transparent: true, opacity: 0.75 });
  for (const p of md.platforms) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), p.approx ? approx : solid);
    mesh.position.set(p.x + offset[0], p.y + offset[1], p.z + offset[2]);
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- models
export type ModelJson = {
  id: string;
  source: string;
  internalName: string;
  mdlVersion: number;
  bindPoseOnly: boolean;
  searchPaths: string[];
  materials: { index: number; name: string; file: string | null; transparent: boolean; missing: boolean; shader: string | null }[];
  bounds: [number, number][];
  groups: { material: number; pos: number[]; normal: number[]; uv: number[]; idx: number[] }[];
};

export async function loadModel(base: string, id: string): Promise<ModelJson> {
  const res = await fetch(`${base}/${id}.json`);
  if (!res.ok) throw new Error(`${base}/${id}.json: ${res.status}`);
  return res.json();
}

/**
 * Models get real lighting, unlike the map: Source baked lightmaps for world
 * geometry only, so a model's shading has to come from the scene.
 */
export function buildModel(model: ModelJson, base: string): BuiltScene {
  const loader = new THREE.TextureLoader();
  const materials = model.materials.map((m) => {
    const mat = new THREE.MeshStandardMaterial({
      map: m.file ? texture(`${base}/${m.file}`, loader) : null,
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.05,
      transparent: m.transparent,
      alphaTest: m.transparent ? 0.5 : 0,
      side: THREE.DoubleSide,
    });
    mat.name = m.name;
    mat.userData.baseMap = mat.map;
    mat.userData.missing = m.missing;
    return mat;
  });

  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (const g of model.groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[g.material] ?? materials[0]);
    mesh.name = model.materials[g.material]?.name ?? `mat${g.material}`;
    root.add(mesh);
    meshes.push(mesh);
  }
  return {
    root, meshes,
    materials: materials as unknown as THREE.MeshBasicMaterial[],
    lightmap: null as unknown as THREE.Texture,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) { m.map?.dispose(); m.dispose(); }
    },
  };
}
