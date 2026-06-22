# Implementation: consolidate-duplicated-cli-helpers-shared-geterrormessage

Low-risk quality cleanup. All changes preserve observable behavior except the
intentional `askYesNo` non-interactive fix in `install.ts`.

## 1. `getErrorMessage` helper + inline replacements

Added to `src/cli/helpers.ts`:

```typescript
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

**Replacements: 53 occurrences across 35 files** (34 consumer files + the 2 internal
uses inside `helpers.ts` itself: `autoCommitFile` and `handleError`).

Replacement was a regex substitution of the exact behavior-identical pattern
`<var> instanceof Error ? <var>.message : String(<var>)` (same identifier in all
three positions) → `getErrorMessage(<var>)`, covering catch-var names `err`,
`error`, `cause`, and `validationErr`. Each consumer file received a
`getErrorMessage` import (merged into an existing `helpers.js` import where one
existed, otherwise a new import line).

Per-file counts (53 total):

| Count | File | Helpers import path |
|------:|------|--------------------|
| 7 | src/cli/commands/install.ts | `../helpers.js` |
| 5 | src/execution/execution-engine.ts | `../cli/helpers.js` |
| 3 | src/cli/commands/specs.ts | `../helpers.js` |
| 3 | src/cli/commands/config.ts | `../helpers.js` |
| 3 | src/cli/commands/tasks.ts | `../helpers.js` |
| 2 | src/cli/commands/backlog.ts | `../helpers.js` |
| 2 | src/cli/commands/complete.ts | `../helpers.js` |
| 2 | src/cli/commands/instructions.ts | `../helpers.js` |
| 1 | src/config/config-loader.ts | `../cli/helpers.js` |
| 1 | src/context/context-engine.ts | `../cli/helpers.js` |
| 1 | src/gates/gate-registry.ts | `../cli/helpers.js` |
| 1 | src/execution/worktree-manager.ts | `../cli/helpers.js` |
| 1 each | changes, execute, reconcile, auto, ship, update, issue, context, init, verify, import, plan, refresh, iteration, check-constitution, propose, quick, status, progress, next, validate-stories, finalize (all in `src/cli/commands/`) | `../helpers.js` |
| 2 | src/cli/helpers.ts (internal: `autoCommitFile`, `handleError`) | n/a (local) |

**Behavior-different sites left untouched** (not the exact pattern): the
`err instanceof Error ? err : new Error(String(err))` rewrap in
`anthropic-provider.ts`, and the `instanceof Error && ...ErrnoException.code`
ENOENT/EEXIST guards in `config.ts`, `config-loader.ts`, `state-store.ts`.

**Circular-import note:** `helpers.ts` imports `config-loader`, `context-engine`,
and `gate-registry`; those three now import `getErrorMessage` back from
`helpers.ts`. This is a function-level (not load-time) cycle — `getErrorMessage`
is only referenced inside function bodies — so ESM and `tsc` resolve it cleanly.
Verified by `tsc --noEmit` passing and the touched-file tests passing. Followed
the intent's explicit instruction to host the helper in `helpers.ts`.

`src/templates/**` was not touched (deployed template bodies, out of scope).

## 2. `askYesNo` dedupe + non-interactive fix

- Deleted the local `function askYesNo(question)` in `install.ts` (the version
  missing TTY/JSON guards that could hang in CI).
- Imported the canonical `askYesNo` from `../helpers.js`.
- Updated the call site to the helpers signature:
  `askYesNo('No git repository detected. Initialize one? [Y/n]', { defaultYes: true, jsonMode: json })`.
  `defaultYes: true` preserves the original "anything but n → yes" semantics for
  the `[Y/n]` prompt; `jsonMode: json` makes the prompt non-blocking under
  `--json`. The question already ends in `[Y/n]`, so the helper does not
  double-append a suffix.
- Removed the now-unused `import { createInterface } from 'node:readline'` from
  `install.ts`.

Signature confirmed compatible: helpers `askYesNo(question, opts?)` returns
`Promise<boolean>`, matching the single `await`ed boolean call site.

## 3. Comments on 9 swallowed `.catch(() => {})` sites

One-line rationale added above each; no behavior change:

- `src/finalize/finalize-lock.ts:91` — lock file may already be gone; missing-file unlink is a no-op.
- `src/execution/worktree-manager.ts:103` — rebase `--abort` is best-effort; the real `HeadAdvancedError` is thrown regardless.
- `src/execution/worktree-manager.ts:125` — merge `--abort` is best-effort; the conflict is returned to the caller anyway.
- `src/ship/merge-safety.ts:84` — restore checkout may fail if tree is detached/dirty; the real failure is still reported.
- `src/ship/merge-safety.ts:119` — dry-run merge cleanup; nothing to abort after a clean fast-forward.
- `src/ship/merge-safety.ts:122` — conflicted dry-run rollback; conflict already recorded.
- `src/ship/merge-safety.ts:179` — reset to snapshot tag; failure already being reported.
- `src/ship/merge-safety.ts:188` — reset to snapshot tag (ancestry check); same rationale.
- `src/cli/commands/install.ts` (`.gitignore` `wx` write) — EEXIST is expected on re-install; existing file intentionally left untouched.

## 4. Internal-only exports made private

Confirmed via grep that nothing outside `helpers.ts` imports `phaseColor` or
`agentColorMap`. Removed the `export` keyword from both:

- `phaseColor()` — now module-private (still used by `banner`).
- `agentColorMap` — now module-private (still used by `agentBanner`).

## 5. Judgment-call extractions

**`readSettingsJson()` in install.ts — EXTRACTED.** The three
`readFile → JSON.parse → throw "exists but is not valid JSON"` blocks
(formerly in `installMettaGuardHook`, `installMettaBashGuardHook`,
`installMettaStatusline`) were byte-identical. Replaced all three with a single
module-local `readSettingsJson(settingsPath): Promise<Record<string, unknown>>`
that returns `{}` when the file is absent and throws the same descriptive error
on invalid JSON. Behavior preserved exactly; verified by `cli-install.test.ts`.

**`loadYamlFile<T>()` — DEFERRED.** None of the 6 candidate sites is a clean
`readFile → YAML.parse → schema.parse` with no extra logic:
- `workflow-engine.ts` — inside a search-path `for` loop with `break`/`continue`
  fallback plus `extends` post-processing.
- `gate-registry.ts` — inside a directory-entry `for` loop that calls
  `this.register()` per file, all wrapped in a swallow-all try/catch.
- `state-store.ts` — uses `safeParse` and throws a custom `StateValidationError`,
  not `schema.parse`.
- `config-loader.ts` — multi-layer/env-override logic; the parse site returns
  `as Record<string, unknown>` without a schema at that point.
- `config-writer.ts` — uses `YAML.parseDocument` (comment-preserving), not
  `YAML.parse` + schema.
A shared loader would force divergent error semantics or an options bag, so
extraction was deferred to preserve behavior.

**`gitCommit()` — DEFERRED** (per intent). Added
`// TODO(consolidate-git-commit): ...` at the git-commit invocation in
`helpers.ts` (`autoCommitFile`) noting the ~7 sites have divergent error
handling and belong in a dedicated refactor.

## Verification

- `npx tsc --noEmit` — PASS (clean, no errors).
- `npm run build` — PASS (tsc + copy-templates).
- `npx vitest run` on cli-install, cli-status, template-deploy-sync, cli-helpers,
  merge-safety, worktree-manager, auto-commit — **7 files, 119 tests, all PASS**.
- Inline-pattern grep:
  `grep -rn "instanceof Error ? .*\.message : String(" src --include='*.ts' | grep -v test | grep -v helpers.ts`
  → **0 matches**. The only remaining occurrence is the `getErrorMessage`
  definition in `helpers.ts:146`.
- Confirmed no local `function askYesNo` remains in `install.ts`.

## Follow-up refinement: relocated getErrorMessage to break the layering cycle

To resolve the circular/layering smell (core modules importing from the CLI layer):

- **New `src/util/errors.ts`** — dependency-free home for `getErrorMessage` (alongside slug.ts, duration.ts).
- **`src/cli/helpers.ts`** — now `import { getErrorMessage } from '../util/errors.js'` (for its own internal use at the handleError path) and `export { getErrorMessage }` so the **29 CLI files keep importing it from `../helpers.js` with zero changes**.
- **5 core (non-CLI) modules repointed** to import from `../util/errors.js` directly: `config-loader.ts`, `gates/gate-registry.ts`, `context/context-engine.ts`, `execution/execution-engine.ts`, `execution/worktree-manager.ts`. None of them import from `cli/helpers` anymore — the core→CLI dependency is gone.
- Barrel (`src/index.ts`) unchanged (util fns are not barrel-exported).

Re-verified: `npx tsc --noEmit` exit 0, `npm run build` OK, targeted tests (cli-install, cli-status, template-deploy-sync) 94 passed.
