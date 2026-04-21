# metta install duplicates stacks: line on every re-run; writeStacksToConfig regex misses plural form

**Captured**: 2026-04-21
**Status**: logged
**Severity**: major

## Symptom

Every re-run of `metta install` on an already-installed project appends another `stacks: [...]` line to `.metta/config.yaml`. Observed in the zeus project, whose config now contains three identical `stacks: ["rust"]` lines (install ran 3×). Downstream, the YAML parser rejects duplicate map keys on every metta command (`Map keys must be unique at line 5, column 3`), `config-loader` logs a warning and silently falls back to default config — disabling stack-driven gate scaffolding and any other config-derived behavior without clear signal.

## Root Cause Analysis

`writeStacksToConfig` at `src/cli/commands/install.ts:177-209` is not idempotent. It detects whether the config already has a stacks entry using the regex `/^\s*stack:\s*"/` at line 189 — but that regex only matches the **legacy singular** form `stack: "<name>"`. When the file already contains the **current plural array** form `stacks: ["rust"]` — which the function itself writes — the regex misses (the trailing `s` breaks the match and `stacks: [` has no opening quote). `stackIdx === -1` falls into the `else` branch at line 193, which unconditionally inserts a fresh `stacks: [...]` line under the first `project:` block. Each subsequent install adds another line. No dedupe check runs before the insert.

The existing idempotency test at `tests/cli.test.ts:102-110` covers exit code and `committed: false` on a second install, but does not inspect `.metta/config.yaml` for duplicate keys, so this regression shipped unnoticed.

### Evidence
- `src/cli/commands/install.ts:189` — regex `/^\s*stack:\s*"/` only matches legacy singular `stack: "..."`; misses the plural `stacks: [...]` form that the function itself writes at line 187.
- `src/cli/commands/install.ts:193-202` — `else` branch unconditionally splices a new `stacks:` line into `project:` block with no dedupe check.
- `/home/utx0/Code/zeus/.metta/config.yaml` — live instance: three identical `stacks: ["rust"]` lines under `project:` after multiple installs.

## Candidate Solutions

1. **Broaden the regex and add an already-present short-circuit** — change line 189 to `/^\s*stacks?:\s*[\["]/` (match both singular and plural) and, before the `else` branch fires, check whether an equivalent `stacks: [...]` line with the same content is already present; if so, return early. Smallest diff; keeps string-munging approach. Tradeoff: still fragile against custom YAML (comments, re-ordered keys, multi-line arrays); doesn't fix the general config-write-is-unsafe pattern.

2. **Switch to proper YAML mutation via the `yaml` library** — read with `yaml.parseDocument(raw)`, mutate `doc.get('project').set('stacks', stacks)`, write back with `doc.toString()`. Preserves comments and handles any existing shape cleanly. Tradeoff: introduces a runtime dep on the document-style API (already transitively available via config-loader); first write may reformat the file cosmetically; more surface to test.

3. **Route through a shared config-writer module** — extract config mutation into `src/config/config-writer.ts` with a typed API (`setProjectField(root, key, value)`), delegate from install and any future writer to it. Solves the category of bug rather than this instance. Tradeoff: largest change; requires moving the existing untyped string manipulation into a proper abstraction; best long-term but overkill if this is the only call-site.

I recommend (1) for the immediate fix plus an assertion in `tests/cli.test.ts:102-110` that the post-install config has exactly one `stacks:` line, then consider (2) or (3) as a follow-up once the assertion is in place.
