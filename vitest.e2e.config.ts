import { defineConfig } from 'vitest/config'

// E2E tier — real corpus + real model. Slow and network-touching, so it's a
// separate config kept out of the default `npm test` run. Invoke via
// `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 120_000
  }
})
