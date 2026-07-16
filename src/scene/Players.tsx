// Every player body except the local first-person view: procedural cowboys
// (capsule + hat) and ninjas (capsule + head wrap), tick-interpolated between the
// two retained frames. A fixed pool of MAX_PLAYERS groups is posed imperatively —
// never one React element per entity per frame.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CFG, STRIDE, TUNING as T } from '../config.ts';
import { getInterpolation } from '../simClient.ts';
import { useStore } from '../store.ts';

const TICK_MS = 1000 / CFG.TICK_HZ;

// FFA slot palette (team modes override): distinct, readable at range
const SLOT_COLORS = [0xd97b29, 0x4f9ddb, 0x5abf6e, 0xd6d64f, 0xc75fce, 0x5fd0c0, 0xd65f5f, 0x9a8cff];
const TEAM_COLORS = [0x3d4a66, 0x8a5a34]; // Masters (ninja navy), Blasters (saddle brown)

interface Rig {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  hat: THREE.Group;
  band: THREE.Mesh;
  bandMat: THREE.MeshStandardMaterial;
  flame: THREE.Mesh;
  aura: THREE.Mesh;
}

export function Players() {
  const rigs = useRef<(Rig | null)[]>(Array(CFG.MAX_PLAYERS).fill(null));
  const camMode = useRef('fp');
  useStore.subscribe((s) => {
    camMode.current = s.camMode;
  });

  useFrame(() => {
    const { prev, curr, currAt } = getInterpolation();
    const teamMode = useStore.getState().settings.mode === 'team';
    for (let i = 0; i < CFG.MAX_PLAYERS; i++) {
      const rig = rigs.current[i];
      if (!rig) continue;
      if (!curr || i >= curr.nPlayers) {
        rig.group.visible = false;
        continue;
      }
      const o = i * STRIDE.PLAYER;
      const c = curr.players;
      const alive = c[o + 13] > 0.5;
      const isLocalFp = i === 0 && camMode.current === 'fp';
      if (!alive || isLocalFp) {
        rig.group.visible = false;
        continue;
      }
      rig.group.visible = true;

      // interpolate between retained frames (same slot; ids are stable slots)
      let x = c[o + 1];
      let y = c[o + 2];
      let z = c[o + 3];
      let yaw = c[o + 7];
      if (prev && i < prev.nPlayers && curr.tick > prev.tick) {
        const span = (curr.tick - prev.tick) * TICK_MS;
        const a = Math.min(1, Math.max(0, (performance.now() - currAt) / span));
        const p = prev.players;
        // NOTE: interpolating from prev toward curr lands us one frame behind curr —
        // the standard tick-interpolation tradeoff (16-50 ms, invisible at this pace)
        x = p[o + 1] + (x - p[o + 1]) * a;
        y = p[o + 2] + (y - p[o + 2]) * a;
        z = p[o + 3] + (z - p[o + 3]) * a;
        let dy = yaw - p[o + 7];
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        yaw = p[o + 7] + dy * a;
      }
      rig.group.position.set(x, y, z);
      rig.group.rotation.y = yaw;

      const ninja = c[o + 21] > 0.5;
      const team = c[o + 14];
      const color = teamMode ? TEAM_COLORS[team % 2] : SLOT_COLORS[i % SLOT_COLORS.length];
      rig.bodyMat.color.setHex(color);
      rig.hat.visible = !ninja;
      rig.band.visible = ninja;
      rig.bandMat.color.setHex(ninja ? 0xd6404d : 0x222222);

      // hp tint: hurt players run hot (the knockback threat readout)
      const hp = c[o + 9] / T.PLAYER_HP;
      rig.bodyMat.emissive.setRGB((1 - hp) * 0.45, 0.02, 0.02);

      const jetting = c[o + 19] > 0.5;
      rig.flame.visible = jetting;
      if (jetting) {
        const s = 0.8 + Math.random() * 0.5;
        rig.flame.scale.set(s, s * (1 + Math.random() * 0.4), s);
      }
      rig.aura.visible = c[o + 15] > 0; // quad seconds remaining
      if (rig.aura.visible) {
        const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.06;
        rig.aura.scale.setScalar(pulse);
      }
    }
  });

  const slots = useMemo(() => Array.from({ length: CFG.MAX_PLAYERS }, (_, i) => i), []);

  return (
    <group>
      {slots.map((i) => (
        <PlayerBody key={i} onRig={(r) => { rigs.current[i] = r; }} />
      ))}
    </group>
  );
}

function PlayerBody({ onRig }: { onRig: (r: Rig) => void }) {
  const group = useRef<THREE.Group>(null);
  const refs = useRef<Partial<Rig>>({});

  const capture = () => {
    const r = refs.current;
    if (group.current && r.bodyMat && r.hat && r.band && r.bandMat && r.flame && r.aura) {
      onRig({ group: group.current, ...r } as Rig);
    }
  };

  return (
    <group ref={(el) => { group.current = el; capture(); }} visible={false}>
      {/* body capsule: feet at local y=0 */}
      <mesh position={[0, T.PLAYER_H / 2, 0]} castShadow>
        <capsuleGeometry args={[T.PLAYER_R, T.PLAYER_H - T.PLAYER_R * 2, 6, 12]} />
        <meshStandardMaterial
          ref={(m) => { if (m) { refs.current.bodyMat = m; capture(); } }}
          color="#888"
          roughness={0.7}
        />
      </mesh>
      {/* cowboy hat */}
      <group ref={(el) => { if (el) { refs.current.hat = el; capture(); } }} position={[0, T.PLAYER_H + 0.02, 0]}>
        <mesh>
          <cylinderGeometry args={[0.55, 0.55, 0.06, 14]} />
          <meshStandardMaterial color="#5e4426" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.3, 0.34, 0.26, 14]} />
          <meshStandardMaterial color="#4e3820" roughness={0.85} />
        </mesh>
      </group>
      {/* ninja head wrap band */}
      <mesh
        ref={(m) => { if (m) { refs.current.band = m; capture(); } }}
        position={[0, T.PLAYER_H - 0.25, 0]}
      >
        <cylinderGeometry args={[T.PLAYER_R * 1.08, T.PLAYER_R * 1.08, 0.16, 12]} />
        <meshStandardMaterial
          ref={(m) => { if (m) { refs.current.bandMat = m; capture(); } }}
          color="#d6404d"
          roughness={0.6}
        />
      </mesh>
      {/* jetpack flame */}
      <mesh
        ref={(m) => { if (m) { refs.current.flame = m; capture(); } }}
        position={[0, -0.25, 0]}
        rotation={[Math.PI, 0, 0]}
      >
        <coneGeometry args={[0.22, 0.7, 10]} />
        <meshStandardMaterial
          color="#ffb347"
          emissive="#ff7a1a"
          emissiveIntensity={2.5}
          transparent
          opacity={0.9}
          toneMapped={false}
        />
      </mesh>
      {/* quad damage aura */}
      <mesh
        ref={(m) => { if (m) { refs.current.aura = m; capture(); } }}
        position={[0, T.PLAYER_H / 2, 0]}
      >
        <sphereGeometry args={[1.1, 16, 12]} />
        <meshStandardMaterial
          color="#a06bff"
          emissive="#7a3df0"
          emissiveIntensity={0.8}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
