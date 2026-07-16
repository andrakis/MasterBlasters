// Render-rate readout for the HUD debug row (distinct from the sim tick rate).

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store.ts';

export function FpsMeter() {
  const frames = useRef(0);
  const windowStart = useRef(0);

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (windowStart.current === 0) windowStart.current = now;
    if (now - windowStart.current >= 500) {
      useStore.getState().setFps(Math.round((frames.current * 1000) / (now - windowStart.current)));
      frames.current = 0;
      windowStart.current = now;
    }
  });

  return null;
}
