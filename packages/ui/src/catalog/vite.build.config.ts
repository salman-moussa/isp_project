import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'ComponentCatalog.tsx'),
      fileName: 'component-catalog',
      formats: ['es'],
      name: 'OrvexComponentCatalog',
    },
    outDir: resolve(import.meta.dirname, '../../../../tmp/ui-catalog-build'),
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
