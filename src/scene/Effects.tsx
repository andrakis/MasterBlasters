// Explosions and sniper tracers, driven by draining the sim's event stream
// imperatively (never through React state). Fixed pools; explosion proximity
// feeds the camera-shake accumulator.

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { drainFx } from '../simClient.ts';
import { addShake } from './shake.ts';

const EXPLOSIONS = 16;
const TRACERS = 8;
const EXPLO_LIFE = 0.45;
const TRACER_LIFE = 0.22;

interface ExploSlot {
  core: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  t0: number;
  r: number;
  active: boolean;
}

interface TracerSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t0: number;
  active: boolean;
}

const mid = new THREE.Vector3();
const dir = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export function Effects() {
  const { camera } = useThree();
  const explos = useRef<ExploSlot[]>([]);
  const tracers = useRef<TracerSlot[]>([]);
  const nextExplo = useRef(0);
  const nextTracer = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const events = drainFx();
    if (events) {
      for (const ev of events) {
        if (ev.t === 'explosion') {
          const pool = explos.current;
          if (pool.length === 0) continue;
          const slot = pool[nextExplo.current % pool.length];
          nextExplo.current++;
          slot.active = true;
          slot.t0 = now;
          slot.r = Math.max(2, ev.r);
          slot.core.position.set(ev.x, ev.y, ev.z);
          slot.ring.position.set(ev.x, ev.y + 0.1, ev.z);
          slot.coreMat.color.setHex(ev.kind === 1 ? 0xa9f05a : 0xffa53d);
          slot.ringMat.color.setHex(ev.kind === 1 ? 0x7ed321 : 0xff7a1a);
          const d = camera.position.distanceTo(slot.core.position);
          addShake(Math.max(0, 0.9 - d / 30) * (ev.kind === 1 ? 1.6 : 1));
        } else if (ev.t === 'tracer') {
          const pool = tracers.current;
          if (pool.length === 0) continue;
          const slot = pool[nextTracer.current % pool.length];
          nextTracer.current++;
          slot.active = true;
          slot.t0 = now;
          dir.set(ev.x1 - ev.x0, ev.y1 - ev.y0, ev.z1 - ev.z0);
          const len = Math.max(0.01, dir.length());
          mid.set((ev.x0 + ev.x1) / 2, (ev.y0 + ev.y1) / 2, (ev.z0 + ev.z1) / 2);
          slot.mesh.position.copy(mid);
          slot.mesh.scale.set(1, len, 1);
          slot.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
        }
        // 'saber' events: the local viewmodel animates itself; remote swing
        // flourishes can land here later.
      }
    }

    for (const s of explos.current) {
      if (!s.active) continue;
      const p = (now - s.t0) / (EXPLO_LIFE * 1000);
      if (p >= 1) {
        s.active = false;
        s.core.visible = false;
        s.ring.visible = false;
        continue;
      }
      s.core.visible = true;
      s.ring.visible = true;
      const ease = 1 - (1 - p) ** 3;
      s.core.scale.setScalar(0.3 + ease * s.r * 0.75);
      s.coreMat.opacity = 0.85 * (1 - p);
      s.ring.scale.setScalar(0.3 + ease * s.r * 1.5);
      s.ringMat.opacity = 0.5 * (1 - p);
    }
    for (const s of tracers.current) {
      if (!s.active) continue;
      const p = (now - s.t0) / (TRACER_LIFE * 1000);
      if (p >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.visible = true;
      s.mat.opacity = 0.9 * (1 - p);
    }
  });

  const eIdx = useMemo(() => Array.from({ length: EXPLOSIONS }, (_, i) => i), []);
  const tIdx = useMemo(() => Array.from({ length: TRACERS }, (_, i) => i), []);

  return (
    <group>
      {eIdx.map((i) => (
        <group key={`e${i}`}>
          <mesh
            visible={false}
            ref={(m) => {
              if (m && !explos.current[i]) {
                explos.current[i] = {
                  core: m,
                  coreMat: m.material as THREE.MeshBasicMaterial,
                  ring: null as unknown as THREE.Mesh,
                  ringMat: null as unknown as THREE.MeshBasicMaterial,
                  t0: 0,
                  r: 4,
                  active: false,
                };
              }
            }}
          >
            <sphereGeometry args={[1, 14, 10]} />
            <meshBasicMaterial color="#ffa53d" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh
            visible={false}
            rotation={[-Math.PI / 2, 0, 0]}
            ref={(m) => {
              const slot = explos.current[i];
              if (m && slot && !slot.ring) {
                slot.ring = m;
                slot.ringMat = m.material as THREE.MeshBasicMaterial;
              }
            }}
          >
            <ringGeometry args={[0.8, 1, 24]} />
            <meshBasicMaterial color="#ff7a1a" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      ))}
      {tIdx.map((i) => (
        <mesh
          key={`t${i}`}
          visible={false}
          ref={(m) => {
            if (m && !tracers.current[i]) {
              tracers.current[i] = {
                mesh: m,
                mat: m.material as THREE.MeshBasicMaterial,
                t0: 0,
                active: false,
              };
            }
          }}
        >
          <cylinderGeometry args={[0.02, 0.02, 1, 6]} />
          <meshBasicMaterial color="#ffe9b0" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}
