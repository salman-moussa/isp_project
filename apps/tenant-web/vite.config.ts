import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 4174 },
  preview: { port: 4174 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    css: true,
  },
});
