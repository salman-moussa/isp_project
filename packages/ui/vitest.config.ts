import { defineConfig } from 'vitest/config';

// Component suites render full forms; give them room when the whole workspace runs at once.
export default defineConfig({ test: { testTimeout: 15_000 } });
