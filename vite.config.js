import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// COOP/COEP headers from day one (matches the sibling repos) so the SharedArrayBuffer
// scaling path needs no config change later. Harmless for the single-worker build.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 4181,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
});
