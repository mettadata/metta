# Correctness Review: fix-metta-framework-parallelism-strengthen-skill-templates

## Verdict

**PASS_WITH_WARNINGS**

All 22 spec scenarios are implemented and pass their tests. Byte-identity is held between `src/templates/skills/` and `.claude/skills/` (md5 matches for both pairs). The union-find + Kahn's toposort implementation in `parallel-wave-computer.ts` is algorithmically sound for the tested shapes. No critical correctness defects. One warning concerns the renderer's `shares files with` annotation heuristic, which is documented as best-effort but can mislead on plausible inputs. A few additional observations are noted as suggestions.

## Findings

### Critical

None.

### Warnings

- **`src/cli/commands/tasks-renderer.ts:44` — `annotateSequentialWave` can misattribute the shared-file sibling.** The annotator picks `priorTasks[priorTasks.length - 1]` (the most recent task ID from any earlier wave) as the "shares files with" target, but it has no access to the original `TaskGraph` and therefore cannot check whether the picked prior task actually shares a file with the current task. Example input: three tasks where 1.1 and 1.2 share `src/shared.ts` and 1.3 has a disjoint file. Wave 1 emits `[1.1, 1.3]` (parallel); wave 2 emits `[1.2]` (sequential). The annotator will output `Task 1.2 (shares files with 1.3)` — but 1.2 actually conflicts with 1.1, not 1.3. The existing integration test only covers a 2-task single-cluster case where the heuristic happens to pick the correct sibling, so the defect is not caught. The file comment at lines 41–43 acknowledges the limitation. To fix correctly, the renderer needs the `TaskGraph` (or cluster map) alongside the `WavePlan`, or the `Wave` shape must carry the cluster id / conflict evidence forward. Not blocking the spec scenarios (none require a named sibling in the output), but user-visible misleading output in plausible real workloads.

- **`src/planning/parallel-wave-computer.ts:141–147` — cross-batch `dependsOn` edges are silently dropped.** `deps.get(t.id)!.add(dep)` runs only `if (byId.has(dep))`, where `byId` is the current batch only. Cross-batch dependencies (parsed correctly by `tasks-md-parser.ts` — see e.g. Task 2.1 declaring `Depends on: Task 1.1`) are silently discarded during wave computation. The algorithm relies on the ambient batch-ordering invariant (batch 2 waves are always numbered after batch 1 waves) to make this safe in practice, but the invariant is implicit: if a contributor ever re-orders batches or extracts per-batch plans in isolation, cross-batch deps become invisible. The inline comment says `only when target is in this batch` but does not explain the ambient-ordering justification. Consider either rejecting cross-batch references, or documenting the assumption visibly. No spec scenario fails under current assumptions.

### Suggestions

- **`src/planning/parallel-wave-computer.ts:165` — intra-cluster alphabetical chain adds one edge per consecutive pair, which is linear and adequate.** Just noting: if a user explicitly declares a `dependsOn` chain that contradicts the alphabetical order within a cluster, the two edge sources together can form a cycle that is correctly caught by Kahn's algorithm. This is desirable behaviour but it does mean certain user errors surface as "Dependency cycle detected" rather than as a more specific "conflicting intra-cluster ordering" diagnostic. Low priority.

- **`src/cli/commands/tasks.ts:49` — stderr vs stdout split for `--json` error envelopes.** When `--json` is passed and the tasks.md is missing, the envelope is printed to stdout (line 12, `outputJson`). The spec scenario `missing_tasks_file_exits_with_code_4` says `stderr contains the expected missing-file path`; strictly, stdout-only JSON does not satisfy that scenario wording. The existing integration test accommodates this by preferring stdout with a fallback to stderr (see `cli-tasks-plan.test.ts:226–229`). The non-JSON path does write to stderr and fulfills the scenario. Low priority: align by printing the JSON envelope to stderr as well, or explicitly scope the scenario to the non-JSON path.

- **`src/planning/tasks-md-parser.ts:108` — GFM checkbox tolerance regex is tight.** `/^\s*(\[[ xX]\]\s*)?$/` matches whitespace-only or `[ ] ` / `[x] ` / `[X] ` leading markers. It rejects `[  ]` (two spaces), `[-]`, or other checkbox-adjacent variants. Acceptable today because remark-parse without GFM emits `[ ] ` / `[x] ` literally. If remark or a downstream writer ever emits a different marker shape, parsing will silently refuse the task line. Low priority.

- **`src/planning/parallel-wave-computer.ts:205` — mode classification.** `ready.length >= 2 && clustersInWave.size >= 2 ? 'parallel' : 'sequential'`. This correctly marks a single-task wave as `sequential`. It also marks a wave of N tasks from 1 cluster as `sequential` (which cannot happen today given per-cluster sequential chains guarantee at most one ready task per cluster per wave, but the guard is defensive). No issue — just confirming the reasoning.

- **`src/cli/commands/tasks.ts:16` — `process.exit(4)` is the hard-coded exit code.** All four error paths (not_found, malformed-read, malformed-parse, cycle) exit 4. The spec only defines exit 4 for `TasksPlanAbsentTasksFile`; it does not say what exit code to use for parse errors or cycles. Using 4 uniformly is reasonable but collapses distinct failure modes. Consider reserving 4 for not-found (per spec) and, e.g., 5 for malformed/cycle, so callers can disambiguate. Low priority.

## Scenarios Checked

All 22 spec scenarios verified implemented:

1. `self_check_block_present_in_propose_skill` — `src/templates/skills/metta-propose/SKILL.md:78` has "Pre-batch self-check" block before the first `Agent(...)` instruction. ✓
2. `self_check_uses_imperative_language` — MUST/SHALL/SHALL NOT present at `SKILL.md:78,117,159`; the literal text `no hedge words — no "consider", "try to", "you may want to"` appears in each block. ✓
3. `self_check_requires_file_listing` — block enumerates file listing, shared/disjoint classification, parallel/sequential declaration, conflicting-file naming. ✓
4. `anti_example_block_present_and_labeled` — ```wrong / ```right fenced code blocks adjacent at `SKILL.md:89/100, 128/136, 170/178`. ✓
5. `anti_example_uses_stable_markers` — fenced code blocks with `wrong` and `right` info strings are contributor-recognizable. ✓
6. `quick_skill_mirrors_propose_anti_example` — `metta-quick/SKILL.md:71/82, 120/128, 171/179` mirror the same pattern. ✓
7. `plan_command_exits_zero_on_valid_tasks_file` — integration test `happy path: disjoint tasks...` confirms. ✓
8. `plan_output_groups_disjoint_tasks_together` — `parallel-wave-computer.test.ts:8–31`. ✓
9. `plan_output_separates_conflicting_tasks` — `parallel-wave-computer.test.ts:33–61`. ✓
10. `plan_output_is_tty_safe` — `renderHumanPlan` emits no ANSI; no `color()` or `\x1b` calls in `tasks-renderer.ts`. ✓
11. `json_flag_produces_parseable_output` — integration test confirms stdout parses to documented schema. ✓
12. `json_wave_groupings_match_human_output` — same underlying `plan` object feeds both renderers. ✓
13. `json_each_wave_contains_required_fields` — `Wave` interface at `parallel-wave-computer.ts:45–49` ensures `wave`, `mode`, `tasks` are always present. ✓
14. `all_independent_tasks_produce_one_wave` — unit test passes. ✓
15. `all_conflicting_tasks_produce_sequential_waves` — unit test passes. ✓
16. `mixed_batch_produces_correct_wave_grouping` — alphabetical cluster ordering + Kahn's level scheduling yield Wave 1 [B, C, A], Wave 2 [D], Wave 3 [E] or similar valid grouping per spec. ✓
17. `depends_on_directive_respected` — unit test `parallel-wave-computer.test.ts:124–145` confirms. ✓
18. `missing_tasks_file_exits_with_code_4` — `tasks.ts:48–49` catches ENOENT, emits exit 4; non-JSON path writes full path to stderr. ✓
19. `missing_tasks_file_message_is_actionable` — error message is the literal string `tasks.md not found: <absolute-path>` including the full expected path. ✓
20. `propose_skill_pairs_are_byte_identical` — md5sum `d63bb7d16da5f17e3e0d369f4dff24c1` matches for both pairs. ✓
21. `quick_skill_pairs_are_byte_identical` — md5sum `a2b33ff1ad3d084b5b993f690ddd84a8` matches for both pairs. ✓
22. `existing_sync_test_still_passes` — `tests/skill-discovery-loop.test.ts` passes (11/11). ✓

## Algorithm-level Spot Checks

- **Union-find correctness** — path compression + union-by-rank in `UnionFind` is textbook; `find` auto-adds unknown nodes for robustness. ✓
- **Cycle detection** — `Kahn's` failure to find a ready node when `scheduled.size < tasks.length` raises with the full list of unscheduled IDs. Test confirms both cycle members appear in the message. ✓
- **Empty/missing `files`** — each empty-file task gets its own singleton cluster because no file maps it into another. `all disjoint + empty` test confirms parallel grouping. ✓
- **Tasks-md parser tolerance of real archived format** — fixture test `parses a subset of a real archived tasks.md fixture correctly` exercises `- [ ] **Task N.M: ...**` pattern; integration test `archived real-world tasks.md runs end-to-end without crashing` consumes the full tasks.md from `2026-04-19-adaptive-workflow-tier-selection-emit-complexity-score-after`. Both pass. ✓
- **`metta tasks plan` CLI surface** — subcommand registered via `registerTasksCommand` at `src/cli/index.ts:12,61`. `--change` is required; `--json` is optional; exit codes: 0 on success, 4 on error. ✓
- **Byte-identity between `src/templates/` and `.claude/` SKILL.md copies** — md5 digests match for both propose and quick pairs. ✓

## Test Run Summary

- `tests/parallel-wave-computer.test.ts` — 7/7 pass
- `tests/tasks-md-parser.test.ts` — 7/7 pass
- `tests/cli-tasks-plan.test.ts` — 6/6 pass
- `tests/skill-discovery-loop.test.ts` — 11/11 pass
- `npx tsc --noEmit` — clean (no errors)
