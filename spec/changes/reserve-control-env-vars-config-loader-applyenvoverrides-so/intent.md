# reserve-control-env-vars-config-loader-applyenvoverrides-so

## Problem

On every skill-initiated metta CLI call, the metta-guard bypass marker `METTA_SKILL=1` is exported into the subprocess environment. `applyEnvOverrides()` in `src/config/config-loader.ts` iterates every `process.env` key that starts with `METTA_` and writes it into the config object without filtering, so `METTA_SKILL=1` becomes config key `skill` (value coerced to `1`). `ProjectConfigSchema` is `.strict()`, so parsing the merged object throws a `ZodError` for the unknown `skill` key. The loader catches the error, re-parses the file-only merge, and emits a warning to stderr:

```
Warning: METTA_* environment variable(s) caused config validation errors (ignored):
  - : Unrecognized key(s) in object: 'skill'
```

There is no functional impact — the offending value is discarded and the file-only config is used. However, the warning fires on every AI-driven command, and it shares the same stderr channel as genuine env-config validation errors (e.g. a misconfigured `METTA_PROVIDERS__...` key). Real misconfiguration warnings are therefore indistinguishable from this noise, defeating the diagnostic value of the warning channel entirely.

**Affects**: `src/config/config-loader.ts` lines 73–101 (override loop) and line 154 (warning emit path). Logged issue: `config-loader-emits-spurious-unrecognized-key-skill-warning`.

## Proposal

In `applyEnvOverrides()` in `src/config/config-loader.ts`, introduce a compile-time reserved-names set:

```ts
const RESERVED = new Set(['METTA_SKILL']);
```

At the top of the env-key loop, add a guard that skips any key present in `RESERVED`:

```ts
if (RESERVED.has(key)) continue;
```

This prevents runtime/control signals from ever being written into the config object, so `ProjectConfigSchema` parsing succeeds on the first attempt and the warning path is never reached for known guard markers.

Additionally, add a unit test alongside the existing config-loader tests that:
1. Sets `process.env.METTA_SKILL = '1'` before calling the loader.
2. Asserts that no warning is emitted to stderr.
3. Asserts that the loaded config object has no `skill` key.

Known tradeoff: the `RESERVED` set is a manual allowlist. Any future guard or runtime marker that uses the `METTA_` prefix must be added to it, or the same noise will reappear. This tradeoff is acceptable for a minor cosmetic fix; a follow-on or the guard trust-model work can adopt a more systematic prefix strategy if needed.

## Impact

- Eliminates persistent stderr noise on every AI-driven metta command.
- Restores the diagnostic value of the env-config warning channel: any warning that appears after this change is a genuine misconfiguration, not a control-signal collision.
- No functional or behavioral change to config loading — the fallback to file-only config for real unknown keys is unchanged.
- Scope: two-line change to `applyEnvOverrides()` and one new unit test. No API surface changes, no schema changes, no CLI changes.

## Out of Scope

- **Guard trust-model hardening** (issue `harden-metta-guard-bash-trust-model-unify-all-blocked`): this change is a noise-only fix. It does not close, overlap with, or prejudice the deferred effort to harden or unify the bypass/trust model for metta-guard.
- **Renaming `METTA_SKILL` to a non-`METTA_` prefix** (Candidate Solution 3 from the issue): rejected. Touching the guard bypass contract carries higher blast radius than the cosmetic problem warrants and risks interfering with the broader guard trust-model work.
- **Filtering the warning string post-hoc** (Candidate Solution 2 from the issue): rejected. It still performs the wasted parse/catch round-trip and only hides the symptom; the bad config key is still constructed, and new unmarked signals would reintroduce the masking risk.
- Any change to `ProjectConfigSchema` strictness or the Zod validation strategy.
- Any change to how `METTA_SKILL` is set, consumed, or documented outside `config-loader.ts`.
