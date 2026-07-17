import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { attachSignaling } from './server/signaling.js';

// Same-origin WebRTC signaling in dev: attach the /signal WebSocket route to
// Vite's own HTTP server, exactly as server/index.js does in prod.
const signaling = {
  name: 'mb-signaling',
  configureServer(server) {
    if (server.httpServer) attachSignaling(server.httpServer);
  },
  configurePreviewServer(server) {
    if (server.httpServer) attachSignaling(server.httpServer);
  },
};

// COOP/COEP headers from day one (matches the sibling repos) so the SharedArrayBuffer
// scaling path needs no config change later. Harmless for the single-worker build.
export default defineConfig({
  plugins: [react(), signaling],
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
