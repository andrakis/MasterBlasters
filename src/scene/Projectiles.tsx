// Rockets and mini-nukes from the latest frame, extrapolated ballistically by
// their velocity (smoother than interpolation for fast movers, and needs no
// prev-frame id matching). Fixed pool, posed imperatively.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STRIDE } from '../config.ts';
import { getInterpolation } from '../simClient.ts';

const POOL = 32;
const up = new THREE.Vector3(0, 1, 0);
const vel = new THREE.Vector3();

interface Slot {
  group: THREE.Group;
  rocket: THREE.Mesh;
  nuke: THREE.Mesh;
}

export function Projectiles() {
  const slots = useRef<(Slot | null)[]>(Array(POOL).fill(null));

  useFrame(() => {
    const { curr, currAt } = getInterpolation();
    const dt = curr ? Math.min(0.1, (performance.now() - currAt) / 1000) : 0;
    for (let i = 0; i < POOL; i++) {
      const slot = slots.current[i];
      if (!slot) continue;
      if (!curr || i >= curr.nProjectiles) {
        slot.group.visible = false;
        continue;
      }
      const o = i * STRIDE.PROJECTILE;
      const p = curr.projectiles;
      slot.group.visible = true;
      const kind = p[o + 1];
      slot.rocket.visible = kind === 0;
      slot.nuke.visible = kind === 1;
      slot.group.position.set(
        p[o + 2] + p[o + 5] * dt,
        p[o + 3] + p[o + 6] * dt,
        p[o + 4] + p[o + 7] * dt,
      );
      vel.set(p[o + 5], p[o + 6], p[o + 7]);
      if (vel.lengthSq() > 1e-6) {
        slot.group.quaternion.setFromUnitVectors(up, vel.normalize());
      }
    }
  });

  const indices = useMemo(() => Array.from({ length: POOL }, (_, i) => i), []);

  return (
    <group>
      {indices.map((i) => (
        <group
          key={i}
          visible={false}
          ref={(el) => {
            if (el) {
              slots.current[i] = {
                group: el,
                rocket: el.children[0] as THREE.Mesh,
                nuke: el.children[1] as THREE.Mesh,
              };
            }
          }}
        >
          {/* rocket: emissive dart aligned to +Y (rotated by velocity) */}
          <mesh>
            <cylinderGeometry args={[0.07, 0.12, 0.55, 8]} />
            <meshStandardMaterial
              color="#ffcb8c"
              emissive="#ff8b2a"
              emissiveIntensity={2.4}
              toneMapped={false}
            />
          </mesh>
          {/* mini nuke: fat green orb */}
          <mesh>
            <sphereGeometry args={[0.28, 12, 10]} />
            <meshStandardMaterial
              color="#a8e06a"
              emissive="#63c21d"
              emissiveIntensity={1.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
