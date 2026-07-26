PASS_WITH_WARNINGS

# Quality Review: metta-uat-runner-skill-execute-change-s-generated-uat-md

Reviewer focus: dead code, naming, duplication, test gaps, docs drift, sibling consistency.

## Findings

### Warnings (should fix)

- warning — `src/cli/commands/refresh.ts:130-156` — `buildWorkflowSection()` hand-maintains the skill listing emitted into every regenerated CLAUDE.md ("### Lifecycle skills" ... "### Setup skills"). `/metta-uat` was not added, so the new skill will never appear in any refreshed CLAUDE.md and remains undiscoverable via the generated workflow reference (and `tests/refresh.test.ts:118` "includes all skills" will keep passing without it). The change spec does not mandate this, but the listing is generator source code, not regenerated docs — it will not self-heal at refresh. Add a `/metta-uat` line (Status or Lifecycle category) plus the matching assertion in `tests/refresh.test.ts`, either in this change or as a logged follow-up.

- warning — `src/templates/skills/metta-uat/SKILL.md:22` vs `src/templates/agents/metta-uat-runner.md:57-64` — the three-part runner return contract is duplicated verbatim (skill step 3 "restatement" vs agent "## Return Contract"). The duplication is spec-mandated (the skill must inject the contract into the spawn prompt), but nothing pins the two copies together: no test asserts the same three clauses appear in both files, so they can drift silently — exactly the failure mode the byte-identity suite exists to prevent for template/deployed pairs. Suggest a small contract test asserting shared key phrases (e.g. "per-step outcome list", "heredoc fallback was triggered") in both files. Positive counterpoint: the run-record schema itself is stated in exactly one authoritative place (the agent's "## Run Record Format") and the skill never restates it — that split is clean.

### Notes (nice to have)

- note — `src/templates/skills/metta-uat/SKILL.md:6` — `allowed-tools: [Read, Grep, Glob, Bash, Agent]` omits the Skill tool, yet step 6 requires invoking `/metta-issue`. This matches existing house precedent (`.claude/skills/metta-fix-gap/SKILL.md` invokes `/metta-propose` via the Skill tool without listing it), so it is consistent, but if `allowed-tools` is ever enforced strictly the failure-logging step would be blocked. Worth confirming once, repo-wide.

- note — `src/templates/agents/metta-uat-runner.md:24` — the "Superseded header note" says "Documents generated before this change" — inside a deployed agent file, "this change" has no referent for a future reader. Anchoring it to the artifact instead ("before the `/metta-uat` runner existed" or "carrying the old sentence ...") would age better.

- note — `tests/cli-skills.test.ts:215-244` — the `expect(template).toBe(deployed)` assertions in both new describes are redundant with the auto-discovered `tests/template-deploy-sync.test.ts` (which already covers `src/templates/agents/**` and `src/templates/skills/**`). The frontmatter/tools/no-model assertions are the real complementary value and are not covered elsewhere. Redundancy matches the existing per-skill pattern (e.g. metta-constitution-checker at lines 179-195), so acceptable; if the file is ever slimmed, drop only the byte-equality lines.

- note — `tests/cli-skills.test.ts:225` — `expect(template).not.toMatch(/hooks:/)` is unanchored: any future body prose mentioning "hooks:" (e.g. documenting the guard hook) would fail this test spuriously. `/^hooks:/m` would target frontmatter only, consistent with the `/^model:/m` anchor used at line 241.

- note — `src/templates/skills/metta-uat/SKILL.md:4` — `argument-hint: "[change-name]"` uses square brackets while all siblings use angle brackets (`"<gap-slug or --all>"`, `"<description ...>"`). Here the argument is genuinely optional and `[...]` is the conventional optional notation, so this is defensible — flagging only as a deliberate divergence, not an error.

- note — `src/templates/skills/metta-uat/SKILL.md` — omits the "IMPORTANT: When using the Agent tool, use these metta agent types ..." banner present in sibling orchestrator skills (metta-verify, metta-quick). Not harmful: step 3 pins `subagent_type: metta-uat-runner` explicitly, so there is no routing ambiguity for the banner to prevent.

## Verified clean

- Naming: skill dir `metta-uat` + frontmatter `name: metta:uat` matches the sibling convention (`metta:verify`, `metta:issue`); agent filename `metta-uat-runner.md` satisfies the `loadAgentDefinition` convention (`src/agents/agent-registry.ts:72` resolves `metta-${shortName}.md`, short name `uat-runner`) with no registry code change, as the spec requires. All filenames kebab-case.
- Template/deployed pairs are byte-identical for both new files (confirmed via diff; also enforced by the auto-discovery suite).
- No stale references to the removed sentence "Do not edit this document to make a step pass." anywhere outside the agent's deliberate superseded-header note (checked src, tests, docs, .claude).
- `tests/uat-template-contract.test.ts` still asserts the `## Reporting failures` heading, the log-a-metta-issue instruction, and `/metta-issue <description>`; the three new `toContain` strings each sit entirely on a single line of `src/templates/artifacts/uat.md` (lines 11, 13, 14), so they match the actual text and cannot silently pass on an empty or gutted file (non-empty `toContain` fails on empty input; `readFile` throws on a missing file).
- Reworded `src/templates/artifacts/uat.md:11-14` header is clear and unambiguous: it names exactly who may edit (`/metta-uat` runner), exactly what is sanctioned (checkbox flips for genuinely observed outcomes; appended dated `## UAT run` records), and restates the two prohibitions (no step-content edits, no unobserved passes).
- `docs/workflows/state.md:225` clause reads naturally in the archive section and correctly scopes the "preserved verbatim" exception. No other hand-authored doc references UAT execution semantics (checked docs/); api.md/architecture.md/getting-started regeneration is a refresh concern, correctly untouched here.
- Sanctioned-region definitions in skill step 4 and the agent's Mutation Algorithm are mutually consistent (`^## UAT run — ` boundary, flips before it, single appended section) — this duplication is required for the orchestrator's independent diff check and shows no drift.
- No dead code: change is markdown templates, docs, and tests only; no TS source touched, no unused imports introduced in the tests.

## Verdict

PASS_WITH_WARNINGS

## Round 2

**Verdict: PASS**

Re-review of fix commit `0092215db` against the round 1 findings.

### Round 1 warnings — resolution

- **Warning 1 (refresh.ts missing `/metta-uat`) — resolved.** `src/cli/commands/refresh.ts:137` adds `- \`/metta-uat\` — execute a change's generated UAT.md acceptance script` between `/metta-verify` and `/metta-ship` in the Lifecycle skills group. Placement matches the lifecycle order (verify → uat → ship) and the line matches the listing's exact style (backtick skill name, em dash, lowercase description). `tests/refresh.test.ts:122` adds `/metta-uat` to the asserted skill list inside the `includes all skills` loop, so the assertion is a real `toContain` check, not cosmetic.
- **Warning 2 (return-contract duplication) — accepted as noted in round 1;** no action expected, none taken.

### Reworded rules review

- **Metta allow-list** (`agents/metta-uat-runner.md:17`): flipping the deny-list to "only `metta status --json` is permitted" is strictly stronger — new subcommands are forbidden by default. The "including but not limited to" enumeration is illustrative, not load-bearing, so it cannot drift into a loophole. Consistent with the untrusted-data clause above it.
- **Non-metta constraint** (`agents/metta-uat-runner.md:18`): the two-condition gate (stated in Do/Run AND plausibly needed for observation) plus the concrete never-list reads naturally alongside sibling agent rule style and does not contradict the "Execute only the step's stated commands" rule — it refines it.
- **Date-anchored glob** (`SKILL.md` step 1): `spec/archive/????-??-??-<name>/UAT.md` is internally consistent with the no-argument path's own statement that archive names are `<YYYY-MM-DD>-<slug>`, and closes the suffix-collision case; both failure-message paths were updated to match.
- **Whole-tree check** (`SKILL.md` step 4): sensible ordering (after the per-file diff check, before commit). Minor wording nit only: the sentence says "modified or newly created tracked file", but a runner-created new file would appear in `git status --porcelain` as untracked (`??`); the preceding "the ONLY modified path is the target UAT.md" requirement still catches it, so no behavioral gap.
- **Pathspec commit** (`SKILL.md` step 5): `git commit -m "..." -- <path>` is correct git — a pathspec-scoped commit includes only changes to matching paths, so pre-staged unrelated content cannot ride along. Rationale sentence is accurate.

### Mechanical checks

- Byte-identity holds: `cmp` clean for both pairs (`.claude/agents/metta-uat-runner.md` vs `src/templates/agents/metta-uat-runner.md`; `.claude/skills/metta-uat/SKILL.md` vs `src/templates/skills/metta-uat/SKILL.md`).
- `npx vitest run tests/refresh.test.ts tests/cli-skills.test.ts` — 36/36 passed.
- `npx tsc --noEmit` — clean.
- `.metta.yaml` gains `review_iterations: 1` — expected bookkeeping, no schema concern.

No new critical issues or warnings. Round 1 notes (unanchored `hooks:` regex in cli-skills.test.ts, `[change-name]` bracket style, omitted agent-types banner) remain open as notes only.
