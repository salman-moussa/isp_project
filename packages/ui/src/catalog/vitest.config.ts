import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true,
  },
  test: {
    css: true,
    environment: 'node',
  },
});
