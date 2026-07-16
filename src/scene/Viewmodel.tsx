// First-person weapon viewmodel — greybox procedural models posed in camera-local
// space. Pure render: the worker resolves every actual shot; this reads the sim's
// confirmed 'fire' events (getLocalFire) for kick/swing timing so the animation
// never lies about whether a shot happened.

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WPN } from '../config.ts';
import { getLocalFire } from '../simClient.ts';
import { useStore } from '../store.ts';

export function Viewmodel() {
  const { camera } = useThree();
  const rig = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);

  const weapon = useStore((s) => s.hud?.weapon ?? WPN.ROCKET);
  const visible = useStore(
    (s) => s.camMode === 'fp' && s.appPhase === 'playing' && (s.hud?.alive ?? false),
  );

  useFrame(({ clock }) => {
    const g = rig.current;
    const h = hand.current;
    if (!g || !h) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const t = clock.elapsedTime;
    const fire = getLocalFire();
    const since = (performance.now() - fire.at) / 1000;

    // rest pose, idle sway
    let px = 0.34;
    let py = -0.3 + Math.sin(t * 1.6) * 0.007;
    let pz = -0.55;
    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (weapon === WPN.SABER) {
      px = 0.3;
      py = -0.26;
      rz = 0.5;
      ry = -0.35;
      if (since < 0.3 && fire.weapon === WPN.SABER) {
        // horizontal sweep across the view
        const p = since / 0.3;
        const sweep = p < 0.5 ? p * 2 : 2 - p * 2;
        ry = -0.35 + sweep * 1.9;
        px = 0.3 - sweep * 0.5;
        rz = 0.5 - sweep * 0.8;
      }
    } else if (since < 0.25 && fire.weapon === weapon) {
      // recoil kick, exponential return
      const kick = Math.exp(-since * 14);
      pz += kick * 0.13;
      rx += kick * 0.12;
    }

    h.position.set(px, py, pz);
    h.rotation.set(rx, ry, rz);
  });

  if (!visible) return null;

  return (
    <group ref={rig}>
      <group ref={hand}>
        {weapon === WPN.ROCKET && (
          <group scale={0.62}>
            <mesh position={[0, 0, -0.25]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.075, 0.085, 0.75, 12]} />
              <meshStandardMaterial color="#6d7680" emissive="#39404a" emissiveIntensity={0.5} metalness={0.4} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0, -0.63]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.09, 0.1, 12]} />
              <meshStandardMaterial color="#3f454b" emissive="#22262b" emissiveIntensity={0.5} metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh position={[0, -0.09, -0.05]}>
              <boxGeometry args={[0.05, 0.12, 0.2]} />
              <meshStandardMaterial color="#525960" emissive="#2a2f34" emissiveIntensity={0.5} roughness={0.7} />
            </mesh>
          </group>
        )}
        {weapon === WPN.SABER && (
          <group rotation={[0.25, 0, 0]}>
            <mesh position={[0, -0.04, 0]}>
              <cylinderGeometry args={[0.028, 0.033, 0.24, 10]} />
              <meshStandardMaterial color="#8f959b" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.018, 0.014, 0.9, 8]} />
              <meshStandardMaterial
                color="#7df1ff"
                emissive="#37d8f0"
                emissiveIntensity={2.2}
                toneMapped={false}
              />
            </mesh>
            <pointLight position={[0, 0.5, 0]} color="#4fdcf2" intensity={1.2} distance={2.5} />
          </group>
        )}
        {weapon === WPN.SNIPER && (
          <group scale={0.7}>
            <mesh position={[0, 0, -0.35]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.03, 0.04, 1.1, 10]} />
              <meshStandardMaterial color="#3d4348" metalness={0.7} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.07, -0.15]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.22, 10]} />
              <meshStandardMaterial color="#22262a" metalness={0.5} roughness={0.4} />
            </mesh>
            <mesh position={[0, -0.08, 0]}>
              <boxGeometry args={[0.05, 0.12, 0.28]} />
              <meshStandardMaterial color="#54402c" roughness={0.8} />
            </mesh>
          </group>
        )}
        {weapon === WPN.NUKE && (
          <group scale={0.75}>
            <mesh position={[0, 0, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.11, 0.13, 0.5, 12]} />
              <meshStandardMaterial color="#4a5240" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0, -0.5]}>
              <sphereGeometry args={[0.11, 12, 10]} />
              <meshStandardMaterial
                color="#87c34a"
                emissive="#5a9427"
                emissiveIntensity={0.8}
              />
            </mesh>
            <mesh position={[0, -0.1, 0.02]}>
              <boxGeometry args={[0.06, 0.14, 0.2]} />
              <meshStandardMaterial color="#33382c" roughness={0.7} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}
