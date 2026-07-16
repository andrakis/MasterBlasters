import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the project root if present. Optional — PORT can also come from
// the shell environment, and falls back to the default below if neither is set.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // no .env file; that's fine.
}

const app = express();
const PORT = process.env.PORT || 3011;
const DIST = join(__dirname, '..', 'dist');

// Cross-origin isolation headers, matching the Vite dev server exactly. The phase-2
// WebRTC signaling route will mount on this same server.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.static(DIST));

// SPA fallback — always serve index.html for unknown routes.
app.get('*', (_req, res) => {
  res.sendFile(join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Master Blasters running at http://localhost:${PORT}`);
  console.log(`Serving: ${DIST}`);
});
