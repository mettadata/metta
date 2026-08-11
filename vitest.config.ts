import { defineConfig } from 'vitest/config'

// CI runners (4-core ubuntu-latest) collapse under 4 concurrent
// `npx tsx` CLI exec chains (~16-20 processes): the `metta install
// --git-init` setup child dies and tests fail on ENOENT for
// .metta/config.yaml. Serialize test files in CI only; local runs
// keep full parallelism. Reproduce CI behavior with `CI=1 npm test`.
const isCI = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    fileParallelism: !isCI,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**'],
    },
  },
})
