# Security Review: adaptive-workflow-tier-selection-emit-complexity-score-after

## Verdict
PASS

## Scope-checked
- `src/complexity/file-count-parser.ts`
- `src/complexity/scorer.ts`
- `src/complexity/renderer.ts`
- `src/cli/commands/complete.ts` (three prompt sites: intent-time downscale, intent-time upscale, post-impl upscale)
- `src/cli/helpers.ts` (`askYesNo`)
- `src/artifacts/artifact-store.ts`
- `src/state/state-store.ts` (YAML write path)
- `src/schemas/change-metadata.ts` (`ComplexityScoreSchema`)
- `src/workflow/workflow-engine.ts` (`loadWorkflow`)

## Threat model covered
- Malicious intent.md / summary.md markdown content attempting to inject YAML into `.metta.yaml`.
- Malicious intent.md attempting to weaponize `--auto` / `auto_accept_recommendation` to collapse the workflow.
- Malicious inline-code tokens (file paths) used to exploit the parser or downstream consumers.
- Malicious workflow name to trigger path traversal in `loadWorkflow`.
- `askYesNo` readline input injection.

## Findings

### Critical
None.

### High
None.

### Medium
None.

### Low

**L1. `askYesNo` answer first-character sniff silently ignores unknown input (`src/cli/helpers.ts:270-279`).**
If a user enters anything other than `y`/`Y`/`n`/`N` (e.g. pastes a multi-line blob, hits arrow keys that send escape sequences, or types "maybe"), the function silently resolves to `defaultYes` (currently always `false` at the three call sites in `complete.ts`). That is the safest default (all three prompts default to "no" which leaves workflow as-is), so this is not a security bug. But if a future caller passes `defaultYes: true` with any destructive action, a stray keystroke could silently be interpreted as confirmation. Consider re-prompting on unknown input when `defaultYes: true`. Advisory, not a fix-before-ship.

**L2. `--json` mode coerces `askYesNo` to the safe default (`src/cli/helpers.ts:258-260`).** This is correct (non-interactive mode must not block), but note that in `--json` mode with `auto_accept_recommendation: true`, the auto-accept branch still fires without going through `askYesNo`. The auto-accept is the *explicit user choice* captured at change creation time, so this is intentional and correct — but worth recording that auto-accept plus `--json` plus a malicious intent.md can silently mutate workflow state (see informational below). Acceptable because auto-accept is opt-in at proposal time, stored in `.metta.yaml`, and visible in every `getChange` read.

### Informational

**I1. `--auto` / `auto_accept_recommendation` + a crafted intent.md can collapse a workflow to the `trivial` tier without a prompt (`src/cli/commands/complete.ts:189-207`).** Worth stating explicitly:
- The file-count signal is parsed from `## Impact` inline-code tokens with a file-like discriminator (extensions in `FILE_EXTENSIONS` or prefixes in `PATH_PREFIXES`).
- A malicious intent author can omit files from `## Impact` to force a low score and auto-collapse the workflow when `auto_accept_recommendation: true`.
- **Mitigations already in place:** (a) `auto_accept_recommendation` is an explicit opt-in per change (`createChange` param), stored in `.metta.yaml`, and never silently set. (b) The downscale path drops planning artifacts only when their status is `pending`/`ready` — work in progress, complete, failed, and skipped stages are preserved (`complete.ts:226-233`). (c) A `workflow_locked: true` flag is plumbed through `ChangeMetadataSchema` for projects that want to disable scoring-driven mutations entirely (although the current `complete` code path does not consult `workflow_locked` — see recommendation below).
- **Recommendation (not blocking):** Before mutating `workflow` via the downscale/upscale branches, check `currentMetadata.workflow_locked === true` and short-circuit to the advisory banner. This is an existing schema field that is not wired through in `complete.ts`. Track as a follow-up — not a security hole because `auto_accept_recommendation` is itself user-opt-in.

**I2. Intent.md / summary.md content never reaches the YAML writer as a string (`src/complexity/scorer.ts:60-67`, `src/schemas/change-metadata.ts:23-31`).**
The `buildScore` function produces a `ComplexityScore` object whose shape is `{ score: number, signals: { file_count: number }, recommended_workflow: 'trivial'|'quick'|'standard'|'full' }`. All fields are numbers or enum members — no user-controlled strings. `ComplexityScoreSchema` (`.strict()`) rejects extra keys, and `ChangeMetadataSchema` (`.strict()`) re-validates on every `StateStore.write`. The `yaml` library (v2+) escapes values correctly, and even if it did not, the values carry no special characters. **YAML injection via markdown content is not possible on this code path.**

**I3. `loadWorkflow` path construction uses `join(searchPath, <tier>.yaml)` where `<tier>` comes from the Zod-validated enum (`src/workflow/workflow-engine.ts:36-46`).** Inside `complete.ts` the values passed to `loadWorkflow` are:
- `metadata.workflow` (user-controlled, but schema-constrained to a string — see caveat below)
- `recommendedTier` (the `recommended_workflow` enum member `'trivial'|'quick'|'standard'|'full'`)

For the recommendation path, the tier is strictly enumerated and cannot contain `../` or path separators. The `metadata.workflow` string is loosely `z.string()` in the schema (`change-metadata.ts:34`) and in principle could contain path separators if the `.metta.yaml` were hand-edited. `loadWorkflow` swallows file-read errors and falls through to "not found" — a traversal attempt would resolve outside the search paths only if (a) the user hand-edits `.metta.yaml` to contain `../../foo` and (b) a matching `foo.yaml` file exists. The worst outcome is loading an arbitrary YAML file from disk, which would then fail `WorkflowDefinitionSchema.parse` and throw. **Not exploitable by a malicious intent.md.** Consider tightening `workflow` in `ChangeMetadataSchema` to `z.string().regex(/^[a-z0-9-]+$/)` as a defense-in-depth measure. Not blocking.

**I4. `file-count-parser.ts` is pure parsing, no I/O, no eval, no regex DoS exposure.**
- `extractText` / `collectInlineCodeNodes` are bounded recursion over a parsed mdast tree — tree size is bounded by `markdownSource.length`, which is bounded by `readArtifact` reading a file the user already authored.
- Deduplication via `Set<string>` is O(n).
- `isFileLikeToken` uses literal `endsWith` / `startsWith` — no regex backtracking.
- File paths are never resolved against the filesystem; they are only counted. **No path sanitization is needed because no path is ever used.** This is the correct design.

**I5. `readline` / `askYesNo` reads one line from stdin via `rl.question` (`src/cli/helpers.ts:261-263`).** The input is assigned to `answer`, trimmed, and the first character is inspected. The answer is never passed to a shell, `exec*`, `eval`, or serializer. There is no injection surface on this input. TTY-guard at line 258 prevents piped-input surprises.

**I6. `complete.ts` auto-commit (`complete.ts:489-498`) uses `execFile('git', ['add', changePath], { cwd })` with an array argv — not shell-interpolated.**
`changePath` is built from `join('spec', 'changes', changeName)`, where `changeName` comes from `options.change` or `listChanges()`. `listChanges` only returns directory names from the filesystem. `options.change` is operator-supplied, not adversary-supplied. Even if it contained shell metacharacters, `execFile` with an argv array does not invoke a shell. **No command injection.**

**I7. Every prompt site has a `catch {}` that swallows errors silently (`complete.ts:319-321`, `422-424`).** This is an availability concern, not a security one — a parser bug cannot crash `complete`. The bodies are scoped narrowly (only the scoring block), so an unrelated exception upstream is not masked. Acceptable per the "advisory-only, must not block" contract stated in the inline comment.

## Summary
No critical or high-severity security findings. The design correctly avoids carrying user-controlled markdown content into YAML state (only bounded integers and a closed enum reach the writer), keeps the parser purely computational with no filesystem access, and handles child-process spawning via `execFile` with argv arrays. The auto-accept + malicious-intent scenario is mitigated by (a) opt-in auto-accept, (b) preservation of non-pending artifact statuses on downscale, and (c) the existing `workflow_locked` flag (which should be wired into the downscale/upscale branches as a follow-up hardening task).

Recommended follow-ups (non-blocking):
1. Wire `workflow_locked` into the downscale/upscale branches in `complete.ts` to short-circuit workflow mutation when the flag is set.
2. Tighten `ChangeMetadataSchema.workflow` to `z.string().regex(/^[a-z0-9-]+$/)` as defense-in-depth against hand-edited `.metta.yaml` files.
3. Consider re-prompting from `askYesNo` on unknown input when `defaultYes: true` is ever used for destructive operations.
