# Research: Shared manifest between metta-guard-bash.mjs and workflow-primer.ts

**Change**: fix-generated-workflow-primer-contradicts-bash-guard-blanket
**Approach researched**: Candidate Solution 2 from the issue — extract the guard hook's allow-lists into a shared module/JSON manifest consumed by both `.claude/hooks/metta-guard-bash.mjs` and `src/delivery/workflow-primer.ts`, so `metta refresh` always emits exactly what the hook permits.
**Date**: 2026-08-26

## 1. Current architecture facts (verified in this worktree)

### 1.1 How the guard hook is loaded and delivered

- **Source of truth**: `src/templates/hooks/metta-guard-bash.mjs`. The repo's own installed copy at `.claude/hooks/metta-guard-bash.mjs` is byte-identical (verified with `diff`).
- **Build**: `npm run build` → `copy-templates` does `cp -r src/templates/hooks dist/templates/hooks` — the whole directory, readdir-blind. A new sibling file in `src/templates/hooks/` ships to dist with **zero build-script changes** (`package.json:18`).
- **Consumer delivery**: `metta install` copies **every file** in `templates/hooks/` into the consumer's `<root>/.claude/hooks/` (readdir-driven, `src/cli/commands/install.ts:30-41,377`), then registers `.claude/hooks/metta-guard-bash.mjs` as a PreToolUse hook in `.claude/settings.json`. So a manifest placed beside the hook in `templates/hooks/` would be installed as a sibling automatically.
- **Runtime**: Claude Code executes the hook as a standalone Node process (`node .claude/hooks/metta-guard-bash.mjs`, event JSON on stdin). It is plain ESM — it already uses `import` for `node:` builtins, so **relative imports of sibling files work** (`import ... from './guard-allowlist.mjs'` or `readFileSync(new URL('./guard-allowlist.json', import.meta.url))`). The hook is currently **deliberately self-contained**: every filesystem read it performs (tokens, audit log) is wrapped with an explicit fail-open/fail-closed decision, and the header comments treat self-containedness as a security property.
- **The four allow/block structures** the primer would need: `ALLOWED_SUBCOMMANDS` (line 38), `ALLOWED_TWO_WORD` (line 48), `ALLOWED_BARE` (line 97), plus (for the Forbidden section) `BLOCKED_SUBCOMMANDS` / `BLOCKED_TWO_WORD` (lines 67, 76). Each entry carries substantial per-entry rationale **comments** — a JSON manifest loses those; an `.mjs` manifest keeps them.

### 1.2 How the primer is built and consumed

- `src/delivery/workflow-primer.ts` exports `workflowPrimerShort()` (used by `src/delivery/claude-code-adapter.ts:76` — init/install scaffold) and `workflowPrimerLong()` (used by `src/cli/commands/refresh.ts:127` — authoritative regeneration). Both are **pure functions returning string arrays built from TS string-literal constants** (`MANDATE`, `ENTRY_POINTS_BULLETS`, `TRUST_MODEL_BULLETS`).
- Convention tension already exists: the constitution says "Template files … are copied to `dist/` at build time — never inlined as string literals" and "No string literal templates in TypeScript code," yet the primer is exactly inlined string literals. A data manifest for the *command lists* would move toward convention compliance; the surrounding prose would remain literals either way (out of scope for this fix).
- Precedent for TS code reading shipped template data at runtime: `install.ts:41` resolves `new URL('../../templates/hooks/', import.meta.url)` from its dist location. The primer module could resolve `../templates/hooks/guard-allowlist.json` the same way, validated with a Zod schema per project convention.

### 1.3 The stale-dist hazard (context, resolved but structurally relevant)

Issue `hooks-and-statusline-execute-stale-main-checkout-dist-via` (logged 2026-08-11, since resolved and archived at `spec/archive/2026-08-11-fix-hooks-statusline-execute-stale-main-checkout-dist-via/`) documented that everything shelling through the globally-linked `dist/` tracks whatever was last built in the main checkout, not source. Two consequences for this approach:

1. The hook must **never** import from the metta package's `dist/` — that resurrects the exact hazard class the archived fix addressed. A manifest must be a **sibling file in `.claude/hooks/`**, delivered by the same install copy as the hook itself, so hook + manifest version together atomically.
2. Even with a sibling manifest, a **deployment-level skew** remains: `metta refresh` renders the primer from the *package's* dist manifest, while enforcement runs the *consumer's installed copy* of hook + manifest. If a consumer upgrades metta and runs `refresh` without re-running `install`, the primer can describe a newer allow surface than the stale installed hook enforces. The manifest eliminates source-level drift only; it cannot eliminate installed-copy drift.

### 1.4 Existing in-repo pattern for cross-file consistency: seam-test pins

`tests/metta-guard-mint-seam.test.ts` already solves the "two standalone hooks must share a constant" problem **without** a shared import: the ADR-4 constant pin (line 209) asserts all four hook copies (source + deployed, mint + guard) contain the literal `const GRACE_MS = 3_600_000`, so drift fails CI loudly. This is the codebase's established answer to exactly this consistency class: duplicated-but-pinned, not runtime-shared.

## 2. The manifest design (best version, if chosen)

- **Location**: `src/templates/hooks/metta-guard-allowlist.mjs` (an ESM data module, not JSON — keeps the per-entry rationale comments, avoids any question about JSON-module import support in the hook, and ships/installs automatically via the existing readdir-driven copies). Exports plain data: `allowedSubcommands: string[]`, `allowedTwoWord: Record<string, string[]>`, `allowedBare: string[]`, `blockedSubcommands: string[]`, `blockedTwoWord: Record<string, string[]>`.
- **Hook side**: replace the five inline structures with a **dynamic `import()` inside try/catch**. On any load/shape failure: print a clear stderr message and `process.exit(2)` (fail closed, guard-wide). A static top-level `import` is **not acceptable**: a module-resolution failure crashes the process with exit code 1, and Claude Code treats any non-2 non-zero exit as a *non-blocking* error — the tool call proceeds. A missing manifest under static import would therefore **silently disable the entire guard (fail open)**, inverting the hook's security posture.[^1] Shape validation must be hand-rolled (the hook cannot depend on Zod — it runs standalone in consumer projects with no `node_modules` guarantee).
- **Primer side**: `workflow-primer.ts` reads the manifest at call time via `readFileSync(new URL('../templates/hooks/metta-guard-allowlist.mjs', import.meta.url))`? No — it's an .mjs module, so `await import()` instead, which forces `workflowPrimerShort/Long` **async** (their two call sites are sync today), or a build-time codegen step. The sync-preserving alternative is a JSON manifest read with `readFileSync` + Zod — but then the hook loses comments and needs `readFileSync`+`JSON.parse` too. Either variant works; JSON + Zod fits the "validate all state/config with Zod" convention better on the TS side, `.mjs` fits the hook better. There is no option that is idiomatic on both sides at once.
- **Build**: zero changes (`copy-templates` copies the hooks dir wholesale; `install` copies it readdir-driven).
- **Tests**: `tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts`, and `tests/metta-guard-mint-seam.test.ts` all spawn the hook files in place (source and deployed pairs), so sibling manifests must exist in **both** `src/templates/hooks/` and `.claude/hooks/` — plus new tests for the fail-closed missing/corrupt-manifest path and a primer-renders-manifest test.

## 3. Failure modes

| Failure | Behavior | Direction |
|---|---|---|
| Manifest missing/corrupt at hook runtime, static import | Process crash, exit 1 → Claude Code proceeds with the tool call[^1] | **Fail OPEN — unacceptable for a guard** |
| Manifest missing/corrupt, dynamic import + try/catch + exit 2 | Every Bash call in the session blocked with a diagnostic | Fail closed — safe but **highly disruptive**: blocks *all* Bash (not just metta), until install is re-run or the hook is disabled |
| Consumer runs `refresh` after upgrade without re-running `install` | Primer (from package dist) describes a different allow surface than the installed hook+manifest enforce | Drift persists at the deployment layer — the manifest does not fully deliver "drift is structurally impossible" |
| Partial install copy (hook copied, manifest not) | Same as row 2 | Only reachable via manual tampering; install copies the dir atomically enough in practice |

The second row deserves emphasis: today the hook has **no way to hard-fail on its own configuration**, and its blast radius on exit 2 is the single offending command. The manifest introduces a new whole-session-blocking failure state that currently cannot exist.

## 4. Effort estimate

- Manifest module + hand-rolled shape validation in hook + fail-closed load path: ~0.5 day
- Primer refactor (async or JSON+Zod variant) + both call sites: ~0.5 day
- Test updates (three hook test suites' fixture expectations, new fail-closed tests, primer tests, deployed-copy sync): ~0.5–1 day
- **Total: roughly 1.5–2 days**, touching a security-critical hook that currently has extensive, carefully-reasoned self-contained behavior — review burden is high relative to the change's nature.

## 5. Assessment and recommendation

**The shared manifest is not justified for this bug.** Reasons:

1. **It is a docs-drift bug.** The enforcement authority (the hook) was never wrong; only the generated prose was. The manifest re-architects the *correct* component (a security hook with deliberate self-containedness) to fix the *incorrect* one (strings in `workflow-primer.ts`).
2. **It introduces a new failure surface in a guard.** The only safe load strategy converts "manifest missing" into "all Bash blocked session-wide" — a failure state that cannot occur today. The unsafe strategy (static import) silently disables the guard entirely.[^1]
3. **It does not actually make drift impossible.** Installed-copy skew (refresh from new dist vs stale installed hook) survives — the same hazard family as the resolved stale-dist issue.
4. **The codebase already has an idiomatic, cheaper drift-proofing pattern.** The ADR-4 constant pin in `tests/metta-guard-mint-seam.test.ts` pins duplicated values across standalone files via CI assertions. The same pattern applies here directly: a seam test that extracts `ALLOWED_SUBCOMMANDS` / `ALLOWED_TWO_WORD` / `ALLOWED_BARE` entries from the hook source (both source and deployed copies) and asserts every entry appears in the primer's read-only subsection (and vice versa). Drift then fails `npm test` loudly at the moment someone edits the hook's allow-lists — "structurally impossible to ship drifted," achieved at CI time instead of runtime, with zero coupling added to the hook.

**Recommendation**: reject the runtime manifest. Implement issue Candidate Solution 1 (rewrite `MANDATE` + Forbidden bullet to scope the ban to mutating commands, add a "Read-only queries (permitted directly)" subsection enumerating the allow surface, sync metta's own CLAUDE.md and `docs/workflows/README.md`), **hardened with a primer↔hook seam test** in the ADR-4 pin style so the hand-synced list cannot silently drift again. That captures ~all of the manifest's benefit at ~a third of the cost and zero new guard failure modes. If a future change makes the allow-lists user-configurable (a real runtime data need), revisit the sibling-`.mjs`-manifest design in section 2 — it is the correct shape for that world.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-26 — PreToolUse exit-code semantics: "exit code 2 is the only exit code that blocks through the code alone… Claude Code treats exit code 1 as a non-blocking error and proceeds with the action."
