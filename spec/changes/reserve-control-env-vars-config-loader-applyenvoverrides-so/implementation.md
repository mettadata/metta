# Implementation: reserve control env vars in config-loader applyEnvOverrides

Resolves issue `config-loader-emits-spurious-unrecognized-key-skill-warning`.

## Problem

`applyEnvOverrides()` in `src/config/config-loader.ts` iterated over every
`process.env` entry that started with the `METTA_` prefix and folded it into the
config object. The metta-guard skill sets `METTA_SKILL=1` as a runtime
skill-bypass marker — not a config override. That marker was being mapped to a
top-level `skill` config key, which then failed Zod validation and printed a
spurious `Unrecognized key(s) in object: 'skill'` / `Warning: METTA_*
environment variable(s) caused config validation errors` message to stderr on
every skill-initiated CLI call.

## The change

`src/config/config-loader.ts`, function `applyEnvOverrides()`:

1. Added a reserved-names set immediately after `const envPrefix = 'METTA_'`:

```ts
// Control/runtime signals that share the METTA_ prefix but are NOT config
// overrides (e.g. the metta-guard skill-bypass marker). Skipping them prevents
// a spurious "Unrecognized key(s) in object: 'skill'" warning on every
// skill-initiated CLI call.
const RESERVED = new Set(['METTA_SKILL'])
```

2. Added a skip inside the env loop, immediately after the existing prefix /
undefined guard:

```ts
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith(envPrefix) || value === undefined) continue
  if (RESERVED.has(key)) continue
  ...
}
```

Everything else in the function is unchanged. Reserved control vars are now
ignored before they reach the config-path mapping, so they never enter the
merged config object and never trigger Zod validation warnings.

## The test

Added to `tests/config-loader.test.ts` (matches the existing stderr-spy test
style; the suite's `afterEach` already deletes all `METTA_*` env vars, which
restores `METTA_SKILL`):

```ts
it('ignores reserved control env var METTA_SKILL without warning or leaking config', async () => {
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Test"
`)
  // METTA_SKILL is the metta-guard skill-bypass marker, not a config override.
  process.env.METTA_SKILL = '1'
  const loader = new ConfigLoader(projectDir, globalDir)
  loader.clearCache()
  const config = await loader.load()
  // File config still loads correctly.
  expect(config.project?.name).toBe('Test')
  // No Zod/unrecognized-key warning emitted to stderr.
  expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('Unrecognized key'))
  expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('METTA_* environment variable(s)'))
  // The reserved control signal does not leak into the config object.
  expect('skill' in config).toBe(false)
  stderrSpy.mockRestore()
})
```

Assertions cover both halves of the issue: (a) no `Unrecognized key` / `METTA_*`
warning reaches stderr, and (b) the loaded config has no `skill` property.

## Verification (light scope)

- `npm run build` — PASS (tsc + copy-templates).
- `npx vitest run tests/config-loader.test.ts` — PASS, 14 tests (1 new).
- `npx tsc --noEmit` — PASS (exit 0).

Full `npm test`, `metta complete/verify/finalize` intentionally not run per task
scope.
