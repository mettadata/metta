# config-loader emits spurious "Unrecognized key 'skill'" warning on every skill-initiated CLI call

**Captured**: 2026-06-22
**Status**: logged
**Severity**: minor

## Symptom

Every skill-initiated metta CLI call prints a spurious warning to stderr: "Warning: METTA_* environment variable(s) caused config validation errors (ignored): - : Unrecognized key(s) in object: 'skill'". There is no functional impact (the offending value is discarded and the file-only config is used), but it is persistent noise on every AI-driven command and it shares the warning channel with genuine env-config validation errors, so it can mask a real misconfigured METTA_PROVIDERS__... override.

## Root Cause Analysis

The metta-guard bypass marker METTA_SKILL=1 is exported into the metta subprocess environment on every skill-initiated CLI call. applyEnvOverrides() blindly maps every process.env key starting with METTA_ into the config object, so it turns METTA_SKILL=1 into config key `skill` (value 1, coerced to number by the numeric branch). ProjectConfigSchema is .strict(), so parsing the merged config throws a ZodError for the unknown `skill` key. The loader catches this, re-parses the file-only merge (which is valid), emits the warning, and falls back to the file config. The control/runtime signal METTA_SKILL is thus mistreated as a config override.

### Evidence
- `src/config/config-loader.ts:73-101` — the override loop iterates every process.env key with the METTA_ prefix and writes it into the config object with no allow/deny filtering, so METTA_SKILL becomes config key `skill`.
- `src/config/config-loader.ts:154` — the warning is emitted from the ZodError catch path after confirming the file-only config parses, which is exactly the spurious-warning channel triggered by the injected `skill` key.

## Candidate Solutions
1. **Reserved-names skip set in applyEnvOverrides** — add RESERVED = new Set(['METTA_SKILL']) and `continue` for any reserved key inside the loop, so control/runtime signals are never treated as config overrides; add a unit test that sets METTA_SKILL=1 and asserts no warning is emitted and the resulting config has no `skill` key. Tradeoff: the reserved set must be kept in sync with future guard/runtime markers, or new markers will reintroduce the same noise.
2. **Suppress the specific Unrecognized-key warning** — filter out ZodError issues whose path matches a known runtime-signal key before emitting the warning string. Tradeoff: still does the wasted parse/catch round-trip and only hides the symptom rather than preventing the bad config key, leaving the masking risk for any future signal not in the filter.
3. **Rename the marker to a non-METTA_ prefix** — change the guard bypass variable so it no longer matches the envPrefix. Tradeoff: touches the guard hook trust contract and risks the broader guard trust-model work (issue harden-metta-guard-bash-trust-model-unify-all-blocked); higher blast radius for a cosmetic fix. Note this issue is a standalone noise fix only and does NOT close that deferred guard trust-model effort.
