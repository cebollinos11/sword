import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Dev server only: `POST /__thumbs/<folder>/<name>.webp` saves the body under public/thumbs/,
 * so the thumbnail page (`#/thumbs`) can write the menu's pictures straight into the repo.
 */
function saveThumbs(): Plugin {
  return {
    name: 'save-thumbs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__thumbs/', (req, res) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        if (req.method !== 'POST' || !/^[a-z]+\/[a-z0-9-]+\.webp$/.test(path)) {
          res.statusCode = 400;
          return res.end('POST /__thumbs/<folder>/<name>.webp');
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const file = resolve(__dirname, 'public/thumbs', path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, Buffer.concat(chunks));
          res.end('saved');
        });
      });
    },
  };
}

// Production build is served from https://cebollinos11.github.io/sword/,
// so dev and preview also serve under /sword/ to match.
export default defineConfig({
  base: '/sword/',
  plugins: [saveThumbs()],
  // three.js alone is ~500 kB minified; that's expected for this app.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fsModuleCache: false,
    // The Rollback session tests replay hundreds of Ticks; under a full parallel run they can need more than the default 5 s.
    testTimeout: 20_000,
  },
});
