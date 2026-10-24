import { defineConfig } from 'vitest/config';

// Several tests spawn node, tsx or a build, and a slow Windows runner can need more than the
// default 5 s; without this the budgets passed to spawnSync would never apply.
export default defineConfig({
  test: { include: ['test/*.test.ts'], testTimeout: 120_000 },
});
