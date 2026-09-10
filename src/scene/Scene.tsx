// Scene composition: sky, lights, the map, and every render system. The map's
// runtime Box list is created here once per map and shared with the prediction
// shim (PlayerRig) and the platform renderer (MapMesh) so mover positions and
// collision always agree.

import { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.ts';
import { MAPS } from '../sim/maps/index.ts';
import { makeBoxes } from '../sim/maps/types.ts';
import { MapMesh } from './MapMesh.tsx';
import { BspWorld } from './BspWorld.tsx';
import { PlayerRig } from './PlayerRig.tsx';
import { Players } from './Players.tsx';
import { Projectiles } from './Projectiles.tsx';
import { Pickups } from './Pickups.tsx';
import { Effects } from './Effects.tsx';
import { FpsMeter } from './FpsMeter.tsx';
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

export function Scene() {
  const mapId = useStore((s) => s.mapId);
  const map = MAPS[mapId] ?? MAPS.mb_test;
  const boxes = useMemo(() => makeBoxes(map), [map]);
  // Maps recovered from the 2007 BSPs ship real textured geometry alongside the
  // collision boxes. When it loads, the boxes stop drawing but keep driving movers.
  const [bspWorld, setBspWorld] = useState(false);
  const onBspLoaded = useCallback((ok: boolean) => setBspWorld(ok), []);

  return (
    <>
      <color attach="background" args={[map.theme.skyBottom]} />
      <fog attach="fog" args={[map.theme.fog, 60, 160]} />
      <hemisphereLight args={[map.theme.skyBottom, 0x0a0a10, 0.9]} />
      <directionalLight position={[18, 30, 12]} intensity={1.5} color={map.theme.sun} />
      <ambientLight intensity={0.35} />

      <Sky top={map.theme.skyTop} bottom={map.theme.skyBottom} />
      <MapMesh map={map} boxes={boxes} visible={!bspWorld} />
      <BspWorld key={map.id} mapId={map.id} onLoaded={onBspLoaded} />
      <PlayerRig map={map} boxes={boxes} />
      <Players />
      <Projectiles />
      <Pickups />
      <Effects />
      <FpsMeter />
      <DevProbe />
    </>
  );
}

/** DEV: a handle on the render scene for the browser gates (window.__mbScene()). */
function DevProbe() {
  const { scene, camera, gl } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __mbScene?: unknown }).__mbScene = () => {
      let found: THREE.Object3D | undefined;
      scene.traverse((o) => { if (o.name === 'skybox') found = o; });
      const s = found ? { obj: found, kids: found.children as THREE.Mesh[] } : null;
      return {
        camera: { pos: camera.position.toArray(), far: (camera as THREE.PerspectiveCamera).far },
        render: { tris: gl.info.render.triangles, calls: gl.info.render.calls },
        sky: s && {
          pos: s.obj.position.toArray(), scale: s.obj.scale.x, meshes: s.kids.length, visible: s.obj.visible,
          tris: s.kids.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0),
          order: s.kids[0]?.renderOrder, depthTest: (s.kids[0]?.material as THREE.Material)?.depthTest,
          fog: (s.kids[0]?.material as THREE.MeshBasicMaterial)?.fog,
        },
        setSkyVisible: (v: boolean) => { if (s) s.obj.visible = v; },
      };
    };
  }, [scene, camera, gl]);
  return null;
}

// Inverted gradient dome. Cheap, theme-driven, and reads as "void below" because
// the bottom hemisphere runs darker than the horizon fog. It is the FIRST thing drawn
// (renderOrder -2000): a recovered map's 3D skybox paints over its lower half at -1000,
// and the world over both.
function Sky({ top, bottom }: { top: number; bottom: number }) {
  const args = useMemo(
    () =>
      [
        {
          uniforms: {
            top: { value: { r: ((top >> 16) & 255) / 255, g: ((top >> 8) & 255) / 255, b: (top & 255) / 255 } },
            bottom: { value: { r: ((bottom >> 16) & 255) / 255, g: ((bottom >> 8) & 255) / 255, b: (bottom & 255) / 255 } },
          },
          vertexShader: /* glsl */ `
            varying vec3 vPos;
            void main() {
              vPos = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 top;
            uniform vec3 bottom;
            varying vec3 vPos;
            void main() {
              float h = normalize(vPos).y;
              // horizon band at h=0, darkening both up (space) and down (void)
              vec3 c = mix(bottom, top, smoothstep(-0.1, 0.6, abs(h)));
              gl_FragColor = vec4(c * (h < -0.15 ? 0.4 : 1.0), 1.0);
            }
          `,
          side: 1, // THREE.BackSide
          depthWrite: false,
        },
      ] as const,
    [top, bottom],
  );

  return (
    <mesh frustumCulled={false} renderOrder={-2000}>
      <sphereGeometry args={[400, 24, 16]} />
      <shaderMaterial args={args as unknown as [Record<string, unknown>]} />
    </mesh>
  );
}
