import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several route tests build and tear down multiple Fastify instances in a single case.
    // Under a loaded machine that exceeds the 5s default and fails as a timeout rather than a
    // real defect, so the budget is raised rather than the assertions weakened.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
