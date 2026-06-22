# Verification: reserve control env vars in config-loader applyEnvOverrides

Resolves issue `config-loader-emits-spurious-unrecognized-key-skill-warning`.

**Verdict: PASS**

The change adds a reserved-names skip set to `applyEnvOverrides()` so the
metta-guard skill-bypass marker `METTA_SKILL` is never folded into the config
object. This eliminates the spurious `Unrecognized key(s) in object: 'skill'`
warning on every skill-initiated CLI call. The fix is precisely scoped — a
non-reserved `METTA_*` key still triggers the genuine misconfiguration warning,
preserving the diagnostic channel.

## Checks

### Check 1 — RESERVED set + skip guard present and correctly positioned — PASS

`src/config/config-loader.ts`:
- `src/config/config-loader.ts:76` — `const RESERVED = new Set(['METTA_SKILL'])`,
  declared after `const envPrefix = 'METTA_'` (line 71).
- `src/config/config-loader.ts:79` — existing prefix/undefined guard
  `if (!key.startsWith(envPrefix) || value === undefined) continue`.
- `src/config/config-loader.ts:80` — `if (RESERVED.has(key)) continue`, placed
  immediately after the prefix check and before the config-path mapping
  (`remainder`/`configPath` at lines 84-85). Reserved keys are skipped before
  they can enter the merged config object.

### Check 2 — New test sets METTA_SKILL, asserts no warning + no `skill` key, restores env — PASS

`tests/config-loader.test.ts`:
- `tests/config-loader.test.ts:189` — test
  `ignores reserved control env var METTA_SKILL without warning or leaking config`.
- Line 196 — sets `process.env.METTA_SKILL = '1'`.
- Lines 203-204 — asserts stderr was NOT called with `'Unrecognized key'` nor
  `'METTA_* environment variable(s)'` (both halves of the warning string).
- Line 206 — asserts `'skill' in config` is `false` (no config leakage).
- Line 201 — asserts the file config still loads (`config.project?.name` ===
  `'Test'`), confirming the skip does not break normal loading.
- Env restoration: the suite-level `afterEach` at
  `tests/config-loader.test.ts:20-26` deletes every `process.env` key starting
  with `METTA_`, which removes the `METTA_SKILL` set by this test. No leakage to
  other tests.

### Check 3 — Scope confined to env-override skip + test; no other behavior change — PASS

- The diff touches only the `RESERVED` declaration and the single `continue`
  guard inside the env loop, plus the new test. The numeric/boolean coercion
  branches, `deepMerge`, the Zod parse/catch fallback path, and the warning emit
  (`src/config/config-loader.ts:160`) are all unchanged.
- No schema change (`ProjectConfigSchema` strictness untouched), no API surface
  change, no CLI change.
- Does NOT close the deferred guard trust-model bypass
  (`harden-metta-guard-bash-trust-model-unify-all-blocked`); intent.md "Out of
  Scope" explicitly disclaims it, and the implementation makes no such claim.

## Gates

| Gate | Command | Result |
|------|---------|--------|
| Build | `npm run build` | PASS (exit 0 — tsc + copy-templates) |
| Typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| Targeted tests | `npx vitest run tests/config-loader.test.ts` | PASS (14 tests, 1 new) |

## Live functional confirmation

Build run first so `dist/` reflects the change, then:

```
METTA_SKILL=1 node dist/cli/index.js status 2>&1 | grep -i "Unrecognized key\|METTA_\* environment" || echo "NO WARNING (fixed)"
```

Result: `NO WARNING (fixed)` — the spurious warning is gone with the marker set.

Negative control (confirms the grep is meaningful and the fix is scoped):

```
METTA_FOO=1 node dist/cli/index.js status 2>&1 | grep -i "Unrecognized key\|METTA_\* environment"
```

Result: warning still fires —
`Warning: METTA_* environment variable(s) caused config validation errors (ignored):`
`  - : Unrecognized key(s) in object: 'foo'`. A genuine unknown `METTA_*` key
still surfaces, so the diagnostic channel is preserved; only the reserved
control marker is suppressed.

## Full-suite note (N/A by design)

The full `npm test` suite was deliberately NOT run, per task scope, due to host
OOM risk. Verification relied on the targeted `tests/config-loader.test.ts` run
plus build + typecheck gates and the live CLI confirmation. The change is a
two-line skip plus one test confined to the config-loader env-override path; the
targeted file fully exercises the changed behavior, so this scoped decision does
not reduce confidence in the verdict.
