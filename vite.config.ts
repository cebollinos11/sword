import { defineConfig } from 'vitest/config';

// Production build is served from https://cebollinos11.github.io/sword/,
// so dev and preview also serve under /sword/ to match.
export default defineConfig({
  base: '/sword/',
  // three.js alone is ~500 kB minified; that's expected for this app.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
