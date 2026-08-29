import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { attachSignaling } from './server/signaling.js';

var port = process.env.PORT || 5182; // 5184 = UNDERCLOUD, 5185 = Sanctuary

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    port: port,
    // fail loudly instead of hopping to the next port — a silent hop once put
    strictPort: true,
    host: true,
    allowedHosts: ['localhost', '.code.stargazer.onl', '.code.home.stargazer.onl'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: port - 1000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      // the BSP viewer is a separate page so it never lands in the game bundle
      input: {
        main: resolve(__dirname, 'index.html'),
        bspview: resolve(__dirname, 'bspview.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
