import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { TUNING } from './config.ts';
import { Scene } from './scene/Scene.tsx';
import { Hud } from './ui/Hud.tsx';
import { Menu } from './ui/Menu.tsx';
import { startSim } from './simClient.ts';
import { useStore } from './store.ts';

export function App() {
  // Start the simulation worker once. startSim() is idempotent, so StrictMode's
  // double-invoked effect (dev only) won't create a second worker.
  useEffect(() => {
    startSim();
  }, []);

  const appPhase = useStore((s) => s.appPhase);

  return (
    <>
      {appPhase === 'playing' && (
        <>
          <Canvas
            camera={{ position: [0, TUNING.EYE_HEIGHT, 0], fov: 75, near: 0.05, far: 500 }}
            dpr={[1, 2]}
            gl={{ antialias: true }}
          >
            <Scene />
          </Canvas>
          <Hud />
        </>
      )}
      {appPhase === 'menu' && <Menu />}
    </>
  );
}
