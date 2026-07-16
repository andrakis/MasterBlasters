// Sky-drop pickups: a falling crate with a light beam announcing the drop line,
// then an idling, spinning box once landed. Fixed pool posed from the latest frame.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STRIDE } from '../config.ts';
import { getInterpolation } from '../simClient.ts';

const POOL = 12;
const KIND_COLORS = [0xe5484d, 0x2ec2e0, 0xcaa53d, 0x87c34a, 0xa06bff];

interface Slot {
  group: THREE.Group;
  box: THREE.Mesh;
  boxMat: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
}

export function Pickups() {
  const slots = useRef<(Slot | null)[]>(Array(POOL).fill(null));

  useFrame(({ clock }) => {
    const { curr } = getInterpolation();
    const t = clock.elapsedTime;
    for (let i = 0; i < POOL; i++) {
      const slot = slots.current[i];
      if (!slot) continue;
      if (!curr || i >= curr.nPickups) {
        slot.group.visible = false;
        continue;
      }
      const o = i * STRIDE.PICKUP;
      const p = curr.pickups;
      const landed = p[o + 5] > 0.5;
      slot.group.visible = true;
      const bob = landed ? Math.sin(t * 2.2 + i) * 0.12 + 0.5 : 0.35;
      slot.group.position.set(p[o + 2], p[o + 3] + bob, p[o + 4]);
      slot.box.rotation.y = t * 1.4 + i;
      slot.box.rotation.x = landed ? 0 : t * 0.9;
      slot.boxMat.color.setHex(KIND_COLORS[p[o + 1]] ?? 0xffffff);
      slot.boxMat.emissive.setHex(KIND_COLORS[p[o + 1]] ?? 0xffffff);
      slot.beam.visible = !landed;
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
              const box = el.children[0] as THREE.Mesh;
              slots.current[i] = {
                group: el,
                box,
                boxMat: box.material as THREE.MeshStandardMaterial,
                beam: el.children[1] as THREE.Mesh,
              };
            }
          }}
        >
          <mesh castShadow>
            <boxGeometry args={[0.55, 0.55, 0.55]} />
            <meshStandardMaterial
              color="#fff"
              emissiveIntensity={0.55}
              roughness={0.4}
              metalness={0.2}
            />
          </mesh>
          {/* drop line: faint beam under the falling crate */}
          <mesh position={[0, -14, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 28, 8, 1, true]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.1}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
