import os from 'node:os'
import { defineConfig } from 'vitest/config'

// CI runners (4-core ubuntu-latest) collapse under 4 concurrent
// `npx tsx` CLI exec chains (~16-20 processes): the `metta install
// --git-init` setup child dies and tests fail on ENOENT for
// .metta/config.yaml. Serialize test files in CI only; local runs
// keep full parallelism. Reproduce CI behavior with `CI=1 npm test`.
const isCI = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'

// On high-core machines the default forks pool spawns one worker per
// core; the many CLI-exec suites each fork `npx tsx` chains (~3-4
// processes per test), oversubscribing the box several times over.
// Under that load, suites that drive the CLI via spawnSync block their
// worker's event loop long enough to trip the worker<->main birpc
// timeout ("[vitest-worker]: Timeout calling \"onTaskUpdate\"", 60s
// hardcoded in vitest), which vitest counts as an unhandled error and
// exits 1 with ZERO failing tests. Budget ~4 cores per worker so total
// process load stays near core count. Half-cores (28 on a 56-core box)
// was empirically still enough load to reproduce the flake; quarter is
// not. Do NOT "fix" this by ignoring unhandled errors.
const localMaxWorkers = Math.max(2, Math.floor(os.availableParallelism() / 4))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    fileParallelism: !isCI,
    ...(isCI ? {} : { maxWorkers: localMaxWorkers }),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**'],
    },
  },
})
