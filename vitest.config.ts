import { defineConfig } from 'vitest/config'

// Unit/integration tier of the test pyramid (eng-review D8).
// Pure logic (importer, chunker, embedder contract, EngineCapabilities,
// guard heuristics) is tested here in plain Node — no Electron needed.
// Playwright-for-Electron E2E lives separately and runs pre-release.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
})
