# Tasks for roadmap-feature

## Batch 1 (no dependencies)

- [x] **Task 1.1: RoadmapStore module (functional core + imperative shell)**
  - **Files**: `src/roadmap/roadmap-store.ts` (new)
  - **Action**: Implement design component 1 exactly per the "RoadmapStore public surface" section: pure `parseRoadmap`/`formatRoadmap`/`validateReorder` exports using `ENTRY_RE` (backticked slug, em-dash note separator, ordinals cosmetic and renumbered on write); `RoadmapEntrySchema`/`RoadmapSchema` Zod schemas built on `SLUG_RE` from `src/util/slug.js`; `RoadmapValidationError` with `type: 'duplicate_entry' | 'invalid_reorder'` (ADR-2); `RoadmapStore` class taking `specDir`, all I/O via a private `StateStore` (`readRaw`/`writeRaw`/`exists` on `roadmap.md`), methods `list` (missing file → `[]`, no create), `add` (`assertSafeSlug` before any I/O, whitespace-only note absent, duplicate → typed error, returns 1-based position), `reorder` (`assertSafeSlug` every arg, `validateReorder`, notes preserved verbatim, single `writeRaw` only after validation), `removeTop` (empty → `null` with no write). Zod parse on every read path and before every write. Writer emits `# Roadmap` + blank line + numbered entries + trailing newline; `parseRoadmap ∘ formatRoadmap` is identity on schema-valid entries. All imports use `.js` extensions.
  - **Verify**: `npx tsc --noEmit`
  - **Done**: File compiles; exports match the design signature block verbatim (`parseRoadmap`, `formatRoadmap`, `validateReorder`, `ReorderCheck`, `RoadmapValidationError`, `RoadmapStore`, `RoadmapEntry`, `RoadmapEntrySchema`, `RoadmapSchema`); no partial-write path exists (every mutation is read → validate → one full `writeRaw`). Satisfies the "single ordered markdown file managed by RoadmapStore" requirement (store half).

- [x] **Task 1.2: buildPromoteHandoff helper + backlog promote recomposition**
  - **Files**: `src/cli/promote-handoff.ts` (new), `src/cli/commands/backlog.ts` (edit)
  - **Action**: Create `export function buildPromoteHandoff(item: { title: string }): string` returning `` `metta propose "${item.title}"` `` (design component 2). Recompose `backlog promote` (src/cli/commands/backlog.ts lines ~96–98) to build its two output strings around the helper — JSON `message: \`Run: ${buildPromoteHandoff(item)}\``, text `` `Promote '${slug}' by running: ${buildPromoteHandoff(item)}` `` — with byte-identical output and no other change to the file.
  - **Verify**: `npx vitest run tests/cli-issue-backlog.test.ts && npx tsc --noEmit`
  - **Done**: Existing backlog CLI tests pass unmodified (locks "backlog behavior verbatim" and promote's exact output bytes); helper is a standalone module importable by `roadmap.ts` without touching a sibling command file. Satisfies the shared-activation-path precondition of the "roadmap next through the promote path" requirement.

- [x] **Task 1.3: Guard hook — Tier-2 roadmap mutations + ALLOWED_BARE view**
  - **Files**: `src/templates/hooks/metta-guard-bash.mjs` + `.claude/hooks/metta-guard-bash.mjs` (edit, byte-identical pair)
  - **Action**: In both copies identically: add `['roadmap', new Set(['add', 'reorder', 'next'])]` to `BLOCKED_TWO_WORD` (existing scope-key branch yields `roadmap:add`/`roadmap:reorder`/`roadmap:next` with no scoping-logic change); add `const ALLOWED_BARE = new Set(['roadmap'])` and, in `classify()` after the `ALLOWED_TWO_WORD` lookup and before `BLOCKED_SUBCOMMANDS`: `if (ALLOWED_BARE.has(inv.sub) && (!inv.third || inv.third.startsWith('-'))) return 'allow'` (ADR-5). `roadmap <any-unknown-word>` must remain `unknown` → fail-closed; bare `metta backlog` stays blocked; no existing backlog/changes entries touched.
  - **Verify**: `npx vitest run tests/template-deploy-sync.test.ts tests/cli-metta-guard-bash-integration.test.ts`
  - **Done**: Both hook copies are byte-identical (sync test passes); all existing guard integration cases still pass, proving backlog/changes classification is unchanged. Satisfies the "guard hook tiers roadmap forms" requirement (hook half).

- [x] **Task 1.4: Mint hook — metta-roadmap scope**
  - **Files**: `src/templates/hooks/metta-session-mint.mjs` + `.claude/hooks/metta-session-mint.mjs` (edit, byte-identical pair)
  - **Action**: In both copies identically: add `SKILL_SCOPES['metta-roadmap'] = ['roadmap:add', 'roadmap:reorder', 'roadmap:next']` alongside the existing entries; update the two "9 Tier-2 skill slugs" comments to 10. No TTL/rotation change.
  - **Verify**: `node --check .claude/hooks/metta-session-mint.mjs && npx vitest run tests/template-deploy-sync.test.ts`
  - **Done**: Both copies byte-identical, syntactically valid, scope entry matches the guard's three scope keys from Task 1.3 exactly. Satisfies the credential-minting half of the "/metta-roadmap skill" requirement.

- [x] **Task 1.5: /metta-roadmap skill (templated pair)**
  - **Files**: `src/templates/skills/metta-roadmap/SKILL.md` + `.claude/skills/metta-roadmap/SKILL.md` (new, byte-identical pair)
  - **Action**: Author the skill mirroring `.claude/skills/metta-backlog/SKILL.md`: frontmatter with `name: metta:roadmap`, `description: Manage the ordered feature roadmap`, `allowed-tools: [Bash, AskUserQuestion]`, and the PreToolUse mint hook `command: .claude/hooks/metta-session-mint.mjs metta-roadmap`. Body: `AskUserQuestion` routing to `view | add | reorder | next`; every mutating flow starts with the allow-listed `metta roadmap --json` (mint-cycle primer + CLI-emitted slugs); `add` sources slugs from `metta backlog list --json`; `reorder` sources current slugs from `metta roadmap --json`; `next` echoes the CLI's `metta propose "<title>"` handoff to the user and never calls `metta propose` itself. Rule block: never invent slugs; always echo CLI output. Content only in the template files — never inlined in TS.
  - **Verify**: `npx vitest run tests/template-deploy-sync.test.ts`
  - **Done**: Both copies byte-identical; frontmatter registers the mint hook with the `metta-roadmap` slug matching Task 1.4; body routes all four operations and carries the no-invented-slugs rule. Satisfies the "/metta-roadmap skill wraps all mutating operations" and "orchestrators answer what-next from the roadmap top entry" routing requirements.

## Batch 2 (depends on Batch 1)

- [x] **Task 2.1: CLI command group + context/barrel wiring**
  - **Depends on**: Task 1.1, Task 1.2
  - **Files**: `src/cli/commands/roadmap.ts` (new), `src/cli/helpers.ts` (edit), `src/cli/index.ts` (edit), `src/index.ts` (edit)
  - **Action**: Implement `registerRoadmapCommand(program)` per the design's "API Design" section, cloned from `backlog.ts`: group default action = read-only status view (no writes, no `assertOnMainBranch`, per-entry `backlogStore.show` with catch → `title: null` + `dangling: true`, text/JSON/empty-state shapes as specified, exit 0 even with dangling entries); `add` (order: context → config → `assertOnMainBranch(projectRoot, config.git?.pr_base ?? 'main', options.onBranch)` → `backlogStore.exists` → `roadmapStore.add` → `autoCommitFile(…, 'chore: add roadmap entry <slug>')`); `reorder` (guard **before** reading roadmap state; `autoCommitFile(…, 'chore: reorder roadmap')`); `next` (empty → `{"next": null}`/text no-op exit 0 with no write; dangling top → `not_found` envelope with the two-remedy message, no pop, per ADR-4; success → `buildPromoteHandoff` message → `removeTop` → `autoCommitFile(…, 'chore: pop roadmap entry <slug>')`). Catch-block mapping order: `instanceof RoadmapValidationError` → `err.type`; `Refusing to write` prefix → `branch_guard`; `Invalid …slug…` prefix → `not_found`; else `roadmap_error`; all exit 4 with `{error: {code, type, message}}` (JSON) / stderr (text); global `--json` via `program.opts().json`. Wiring: add `roadmapStore: RoadmapStore` to `CliContext` and construct it in `createCliContext` next to `backlogStore` (same `specDir`); call `registerRoadmapCommand(program)` in `src/cli/index.ts` alongside the other `register*Command` calls; add `export * from './roadmap/roadmap-store.js'` to `src/index.ts`.
  - **Verify**: `npx tsc --noEmit && npm run build && node dist/cli/index.js roadmap --json` (expect `{"roadmap": []}` exit 0) `&& node dist/cli/index.js roadmap --help` (expect `add`, `reorder`, `next` listed)
  - **Done**: All four command forms registered and reachable; `roadmapStore` on `CliContext`; `RoadmapStore` importable from the package root barrel; `BacklogStore` consumed read-only. Satisfies the status-view, dangling-entries, add, reorder, next, branch-discipline, error-contract, and additive-wiring requirements (implementation half; test coverage in Task 3.1).

- [x] **Task 2.2: RoadmapStore unit tests**
  - **Depends on**: Task 1.1
  - **Files**: `tests/roadmap-store.test.ts` (new)
  - **Action**: Unit tests mirroring `tests/backlog-store.test.ts` (path per ADR-3 — `tests/`, not the spec's literal `test/roadmap/`): format→parse round-trip with ordered entries, notes verbatim (including embedded ` — ` in a note) and Zod validation; missing file → `[]` without creating it; unsafe slug (`../etc/passwd`) throws from `assertSafeSlug` before any I/O with `spec/roadmap.md` untouched; `add` duplicate → `RoadmapValidationError` with `type: 'duplicate_entry'` and file byte-for-byte unchanged; `validateReorder`/`reorder` rejects omission, addition, and duplicate (each with `type: 'invalid_reorder'`, message enumerating offenders, file untouched — before/after byte comparison) and preserves notes on success; `removeTop` pops entry 1 and returns it, returns `null` on empty with no write; canonical rewrite renumbers ordinals.
  - **Verify**: `npx vitest run tests/roadmap-store.test.ts`
  - **Done**: All listed behaviors covered and green; 1:1 test-to-source pairing for `src/roadmap/roadmap-store.ts` established. Closes the test-file clause of the RoadmapStore requirement and the no-partial-write clauses at the store layer.

- [x] **Task 2.3: Guard integration test additions**
  - **Depends on**: Task 1.3, Task 1.4
  - **Files**: `tests/cli-metta-guard-bash-integration.test.ts` (edit)
  - **Action**: Add cases: uncredentialed `metta roadmap add foo`, `metta roadmap reorder a b`, and `metta roadmap next` are each blocked via the Tier-2 `roadmap` entries with a rejection pointing at the skill path; bare `metta roadmap` and `metta roadmap --json` are allowed without a credential; `roadmap <unknown-word>` (e.g. `roadmap frobnicate`) stays fail-closed; existing `backlog add/done/promote` and `changes abandon` uncredentialed blocks re-asserted unchanged; mint scope for `metta-roadmap` grants exactly `roadmap:add`/`roadmap:reorder`/`roadmap:next`.
  - **Verify**: `npx vitest run tests/cli-metta-guard-bash-integration.test.ts`
  - **Done**: New and pre-existing guard cases all green. Closes the scenarios of the "guard hook tiers roadmap forms" requirement, including the unchanged-existing-entries scenario.

## Batch 3 (depends on Batch 2)

- [x] **Task 3.1: Roadmap CLI integration tests**
  - **Depends on**: Task 2.1
  - **Files**: `tests/cli-roadmap.test.ts` (new)
  - **Action**: Integration tests modeled on `tests/cli-issue-backlog.test.ts`, covering every spec scenario not owned by 2.2/2.3: populated view in order with resolved titles and notes (text + `--json`, exit 0, no writes); view on a non-main branch with no guard; empty roadmap friendly state in both modes; dangling entry listed at position with text indicator and JSON `dangling: true` while healthy entries omit the flag, exit 0; `add` success with note + auto-commit (`committed`/`commit_sha` in JSON, position reported); `add` unknown slug → `not_found` envelope exit 4 with `spec/roadmap.md` byte-unchanged and `spec/backlog/` never written; `add` duplicate → `duplicate_entry`; `reorder c a b` rewrites order preserving notes + auto-commit; omission/addition/duplicate reorders each → `invalid_reorder` exit 4 with the file byte-identical after all three; `next` success emits the `metta propose "Foo feature"` handoff via the promote path, pops the top so the second entry becomes top, auto-commits; `next` on empty → `{"next": null}` / text no-op, exit 0, no write, no commit; `next` with dangling top → `not_found` envelope naming both remedies, no pop (ADR-4); branch guard blocks all three mutations off-main with `branch_guard` exit 4 (reorder rejected before permutation validation), `--on-branch` escape hatch commits on the current branch; envelope-shape assertion across all four failure types (`code: 4`, non-empty `message`); text-mode failures on stderr; `createCliContext()` exposes `roadmapStore` and `RoadmapStore` is importable from the barrel.
  - **Verify**: `npx vitest run tests/cli-roadmap.test.ts`
  - **Done**: Every scenario from the status-view, dangling, add, reorder, next, branch-discipline, error-contract, and additive-wiring requirements has a passing assertion; before/after byte comparisons prove no failing invocation touches `spec/roadmap.md`.

## Batch 4 (depends on Batch 3) — constitution gates

- [x] **Task 4.1: Full gates — suite, types, lint, build, template deployment**
  - **Depends on**: Task 2.2, Task 2.3, Task 3.1
  - **Files**: none new (fix-forward only if a gate fails)
  - **Action**: Run the full constitution gate set over the completed change. Confirm the whole suite (including `tests/template-deploy-sync.test.ts`, backlog, and guard suites) is green, strict types pass, the repo lint gate (`npm run lint`, which is `tsc --noEmit` here) passes, the build succeeds, and `copy-templates` lands the new/edited template files in `dist/` with no `package.json` change.
  - **Verify**: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && ls dist/templates/skills/metta-roadmap/SKILL.md dist/templates/hooks/metta-guard-bash.mjs dist/templates/hooks/metta-session-mint.mjs && cmp dist/templates/skills/metta-roadmap/SKILL.md .claude/skills/metta-roadmap/SKILL.md`
  - **Done**: All commands exit 0; `dist/templates/` contains the roadmap skill and both edited hooks byte-identical to their deployed copies; zero regressions across the existing suite. Change is gate-clean and ready for verify/finalize.
