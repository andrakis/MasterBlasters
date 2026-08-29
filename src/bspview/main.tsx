import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  loadMapScene, buildScene, buildBrushBoxes, buildMapDefBoxes,
  type MapScene, type BuiltScene, type MapDefJson,
} from './scene.ts';

const MAP = new URLSearchParams(location.search).get('map') ?? 'mb_columns';
const BASE = `/maps/${MAP}`;

/** WASD + mouse-look fly camera. Shift boosts, Q/E for vertical. */
function FlyCamera({ speed }: { speed: number }) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const locked = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const canvas = gl.domElement;
    const click = () => canvas.requestPointerLock();
    const lockChange = () => { locked.current = document.pointerLockElement === canvas; };
    const move = (e: MouseEvent) => {
      if (!locked.current) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * 0.0022;
      euler.current.x -= e.movementY * 0.0022;
      euler.current.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    canvas.addEventListener('click', click);
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      canvas.removeEventListener('click', click);
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('mousemove', move);
    };
  }, [camera, gl]);

  useEffect(() => {
    // headless probe hook, mirrors the __mb* convention in CLAUDE.md
    (window as unknown as Record<string, unknown>).__bspCam = camera;
    (window as unknown as Record<string, unknown>).__bspLook = (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => {
      camera.position.set(px, py, pz);
      camera.lookAt(lx, ly, lz);
    };
  }, [camera]);

  useFrame((_, dt) => {
    const k = keys.current;
    const v = new THREE.Vector3(
      (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0),
      (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0),
    );
    if (v.lengthSq() === 0) return;
    v.normalize().multiplyScalar(speed * (k.ShiftLeft || k.ShiftRight ? 4 : 1) * Math.min(dt, 0.1));
    const up = v.y;
    v.y = 0;
    v.applyQuaternion(camera.quaternion);
    v.y += up;
    camera.position.add(v);
  });
  return null;
}

type Toggles = {
  textures: boolean; lightmap: boolean; brushes: boolean; spawns: boolean;
  wireframe: boolean; mapdef: boolean; brightness: number;
};

function MapView({ scene, mapdef, toggles }: { scene: MapScene; mapdef: MapDefJson | null; toggles: Toggles }) {
  const built = useRef<BuiltScene | null>(null);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const brushBoxes = useMemo(() => buildBrushBoxes(scene), [scene]);
  // bsp2mapdef recentres on the spawn cluster; undo that to overlay in world space
  const mapdefBoxes = useMemo(() => {
    if (!mapdef) return null;
    const sp = scene.entities.filter((e) => e.classname === 'info_player_deathmatch' && e.origin);
    if (!sp.length) return buildMapDefBoxes(mapdef, [0, 0, 0]);
    const cx = sp.reduce((s, e) => s + e.origin![0], 0) / sp.length;
    const cz = sp.reduce((s, e) => s + e.origin![2], 0) / sp.length;
    const deckY = Math.min(...sp.map((e) => e.origin![1]));
    return buildMapDefBoxes(mapdef, [cx, deckY, cz]);
  }, [mapdef, scene]);

  useEffect(() => {
    const b = buildScene(scene, BASE);
    built.current = b;
    setObj(b.root);
    return () => { b.dispose(); built.current = null; };
  }, [scene]);

  useEffect(() => {
    const b = built.current;
    if (!b) return;
    for (let i = 0; i < b.materials.length; i++) {
      const mat = b.materials[i];
      const src = scene.materials[i];
      mat.map = toggles.textures ? (mat.userData.baseMap ?? null) : null;
      // materials we could not resolve are stock Valve content; render them as
      // flat void rather than pretending they lit up
      if (src.missing) { mat.color.setHex(0x0b0b0d); mat.lightMapIntensity = 0; }
      else {
        mat.color.setHex(toggles.textures ? 0xffffff : 0xb0b0b0);
        mat.lightMapIntensity = toggles.lightmap ? toggles.brightness : 0;
        if (!toggles.lightmap) mat.color.multiplyScalar(0.55);
      }
      mat.wireframe = toggles.wireframe;
      mat.needsUpdate = true;
    }
  }, [scene, toggles, obj]);

  const spawns = useMemo(
    () => scene.entities.filter((e) => e.classname === 'info_player_deathmatch' && e.origin),
    [scene],
  );
  const makers = useMemo(
    () => scene.entities.filter((e) => e.classname === 'env_entity_maker' && e.origin),
    [scene],
  );

  return (
    <>
      {obj && <primitive object={obj} />}
      {toggles.brushes && <primitive object={brushBoxes} />}
      {toggles.mapdef && mapdefBoxes && <primitive object={mapdefBoxes} />}
      {toggles.spawns && (
        <>
          {spawns.map((e) => (
            <mesh key={`s${e.index}`} position={e.origin!}>
              <capsuleGeometry args={[0.4, 1.0, 4, 8]} />
              <meshBasicMaterial color={0x33ff88} wireframe />
            </mesh>
          ))}
          {makers.map((e) => (
            <mesh key={`m${e.index}`} position={e.origin!}>
              <octahedronGeometry args={[0.6]} />
              <meshBasicMaterial color={0xffcc33} wireframe />
            </mesh>
          ))}
        </>
      )}
    </>
  );
}

function App() {
  const [scene, setScene] = useState<MapScene | null>(null);
  const [mapdef, setMapdef] = useState<MapDefJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [speed, setSpeed] = useState(18);
  const [toggles, setToggles] = useState<Toggles>({
    textures: true, lightmap: true, brushes: false, spawns: true,
    wireframe: false, mapdef: false, brightness: 2.4,
  });

  useEffect(() => { loadMapScene(BASE).then(setScene).catch((e) => setErr(String(e))); }, []);
  useEffect(() => {
    // optional: only maps that have been through bsp2mapdef have this
    fetch(`${BASE}/mapdef.json`).then((r) => (r.ok ? r.json() : null)).then(setMapdef).catch(() => {});
  }, []);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__bspToggles = (patch: Partial<Toggles>) =>
      setToggles((t) => ({ ...t, ...patch }));
    (window as unknown as Record<string, unknown>).__bspScene = scene;
  }, [scene]);

  const set = <K extends keyof Toggles>(k: K, v: Toggles[K]) => setToggles((t) => ({ ...t, [k]: v }));
  const cb = (k: keyof Toggles, label: string) => (
    <label style={{ display: 'block', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!toggles[k]} onChange={(e) => set(k, e.target.checked as never)} />{' '}
      {label}
    </label>
  );

  if (err) return <pre style={{ color: '#f66', padding: 20, font: '13px monospace' }}>{err}</pre>;

  return (
    <>
      <Canvas
        camera={{ fov: 75, near: 0.1, far: 4000, position: [0, 12, 40] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; }}
        style={{ position: 'fixed', inset: 0, background: '#0a0a0c' }}
      >
        <FlyCamera speed={speed} />
        {scene && <MapView scene={scene} mapdef={mapdef} toggles={toggles} />}
      </Canvas>
      <div style={{
        position: 'fixed', top: 12, left: 12, padding: '10px 14px', borderRadius: 6,
        background: 'rgba(10,10,14,.82)', color: '#dfe3ea', font: '12px/1.7 ui-monospace, monospace',
        border: '1px solid #2a2f3a', minWidth: 210,
      }}>
        <div style={{ fontWeight: 700, letterSpacing: '.08em', marginBottom: 6 }}>{MAP.toUpperCase()}</div>
        {scene && (
          <div style={{ opacity: .65, marginBottom: 8 }}>
            {scene.groups.reduce((n, g) => n + g.idx.length / 3, 0)} tris · {scene.materials.length} mats ·
            {' '}{scene.brushes.length} brushes<br />
            lightmap {scene.lightmap.width}×{scene.lightmap.height} · VBSP v{scene.bspVersion}
          </div>
        )}
        {cb('textures', 'textures')}
        {cb('lightmap', 'lightmap (2007 bake)')}
        {cb('brushes', 'brush volumes')}
        {cb('spawns', 'spawns / drops')}
        {cb('wireframe', 'wireframe')}
        {mapdef && cb('mapdef', `MapDef boxes (${mapdef.platforms.length})`)}
        <label style={{ display: 'block', marginTop: 6 }}>
          bake ×{toggles.brightness.toFixed(1)}
          <input type="range" min={0.2} max={4} step={0.1} value={toggles.brightness}
            onChange={(e) => set('brightness', +e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ display: 'block' }}>
          speed {speed}
          <input type="range" min={2} max={60} step={1} value={speed}
            onChange={(e) => setSpeed(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <div style={{ opacity: .5, marginTop: 8, fontSize: 11 }}>
          click to look · WASD · Q/E up-down · shift boost
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
