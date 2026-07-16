// Platforms drawn straight from the shared Box list. Runs at useFrame priority -1
// so mover positions are updated (via the same updateMovers the sim uses, at the
// interpolated fractional tick) before the prediction shim and every other system
// reads them this frame.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CFG } from '../config.ts';
import { updateMovers, type Box, type MapDef } from '../sim/maps/types.ts';
import { getInterpolation } from '../simClient.ts';

const TICK_MS = 1000 / CFG.TICK_HZ;

export function MapMesh({ map, boxes }: { map: MapDef; boxes: Box[] }) {
  const groups = useRef<(THREE.Group | null)[]>([]);

  useFrame(() => {
    const { curr, currAt } = getInterpolation();
    const fracTick = curr ? curr.tick + Math.min(2, (performance.now() - currAt) / TICK_MS) : 0;
    updateMovers(boxes, fracTick, CFG.TICK_HZ);
    for (let i = 0; i < boxes.length; i++) {
      const g = groups.current[i];
      if (g) g.position.set(boxes[i].x, boxes[i].y, boxes[i].z);
    }
  }, -1);

  return (
    <group>
      {boxes.map((b, i) => {
        const p = b.def;
        const mover = p.kind === 'mover';
        return (
          <group key={i} ref={(el) => { groups.current[i] = el; }} position={[b.x, b.y, b.z]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[p.w, p.h, p.d]} />
              <meshStandardMaterial
                color={mover ? map.theme.accent : map.theme.platform}
                roughness={0.85}
                metalness={0.1}
              />
            </mesh>
            {/* accent trim on the walkable top face */}
            <mesh position={[0, p.h / 2 + 0.02, 0]}>
              <boxGeometry args={[p.w - 0.15, 0.04, p.d - 0.15]} />
              <meshStandardMaterial
                color={mover ? map.theme.platform : map.theme.accent}
                roughness={0.6}
                metalness={0.2}
                opacity={0.55}
                transparent
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
