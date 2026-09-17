import { defineConfig } from 'vitest/config';

// jsdom so browser globals (window.location, localStorage) exist: services/api.ts
// computes its API URL from window.location at module load.
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
