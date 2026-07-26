# Research: UAT runner skill — consolidated findings

Change: metta-uat-runner-skill-execute-change-s-generated-uat-md

Three parallel research tracks were run; per-track artifacts live beside this file:

- `research-capability-home.md` — where the 10 spec requirements should merge
- `research-skill-shape.md` — skill frontmatter/guard/hook verification
- `research-run-record.md` — UAT.md mutation mechanics and archive policy

## Track 1 — Capability home (`research-capability-home.md`)

**Question:** merge the delta into `finalize-ship`, or create a net-new `uat-execution` capability?

**Findings:** `SpecMerger.merge` derives one capability from the delta's single H1 (`src/finalize/spec-merger.ts:72`) — a change cannot split requirements across two capabilities. The `<!-- new-capability -->` marker must be the first non-blank line under the H1 (`src/cli/commands/complete.ts:63-81`); `roadmap-feature` (2026-07-26) is a fresh end-to-end precedent of the marker path. finalize-ship today is 19 requirements / ~8.5K tokens, 9 of them already UAT generation; adding 10 execution requirements would make it 29 requirements, 66% UAT, ~12.5K tokens (deep into `section` context-loading territory), while none of the 10 new requirements touch finalize code. The spec store's grain is small focused capabilities (propose-stop-after 8, workflow-parallelism-discipline 7, roadmap-feature 12). All 10 deltas are ADDED, so `createCapabilitySpec` + append merges a net-new capability cleanly.

**Decision: create the net-new `uat-execution` capability.** The required two-line edit to this change's `spec.md` (H1 `# uat-execution`, then `<!-- new-capability -->` as the first non-blank line after it) has been applied by the orchestrator as part of recording this decision. UAT *generation* remains a finalize-ship concern; UAT *execution* — different trigger, actors, and artifacts — gets its own home. Cost: one cross-reference (the `src/templates/artifacts/uat.md` header rewording is owned by finalize-ship but mandated by a uat-execution requirement).

## Track 2 — Skill shape (`research-skill-shape.md`)

**Question:** can `/metta-uat` be non-forked, main-session, no mint hook, no Tier-2 subcommands?

**Verdict: yes — the claim holds; ship it hook-less.** `metta-guard-bash.mjs` tokenizes only `metta` invocations — plain `git add`/`git commit` pass untouched (lines 82-110, 234-241); `metta status --json` is allow-listed; Agent spawns are ungated. The mint hook scopes only Tier-2 `metta` subcommands and cannot even mint for an unregistered slug (`metta-session-mint.mjs:18-29, 44-46`) — the mint contingency is closed as "not needed and not implementable without a forbidden hook edit." Exact structural precedent: `metta-check-constitution` (hook-less main-session skill with Bash + Agent). Install is readdir-driven (`src/delivery/command-installer.ts:11-58`) — zero install-code or inventory-test changes. Recommended frontmatter: `name: metta:uat`, `argument-hint: "[change-name]"`, `allowed-tools: [Read, Grep, Glob, Bash, Agent]` — no Write/Edit (the runner owns all document edits), no hooks block. Active change resolves via `metta status --json` (fallback: `Glob spec/changes/*/.metta.yaml`); newest archive = descending name-sort of `spec/archive/*/` dirs filtered to those containing UAT.md.

**Key risks surfaced:**
1. `metta-guard-edit.mjs` blocks Edit/Write when no change is active and does not allow-list `spec/archive/` — so for archived runs the runner's heredoc fallback is the **common path**, not the exception. The agent contract must require the heredoc rewrite to reproduce the entire document byte-for-byte outside sanctioned regions. (Empirically confirmed: every subagent in this change's planning hit that guard.)
2. Guard-bash trusts any `metta-*` agent_type — the runner's no-git/no-`metta`-mutating-subcommand prohibitions are contractual (agent body text), same posture as every existing metta agent.
3. `Run:` hints could name `metta` commands; the agent body must restrict execution to the step's stated command and forbid state-mutating `metta` subcommands.
4. Template + deployed copies must land in the same commit (orphan check in `tests/template-deploy-sync.test.ts:71`).
5. Multiple active changes: with no argument, prefer the active change that has a UAT.md; if several qualify, fail with the candidate list.

## Track 3 — Run-record and archive semantics (`research-run-record.md`)

**Question:** exact mutation mechanics and archived-entry policy.

**Findings:** generated checkbox lines are always exactly `- [ ] Pass` at line start (`uat-generator.ts:438-442`), and `flattenField` guarantees step text can never produce a whole line of checkbox syntax — but archived UAT.md files already contain **mid-line** quoted `- [ ] Pass` strings (e.g. `spec/archive/2026-07-25-fix-four-warning-level-findings-uat-generation-change-s/UAT.md:79`), so a naive global replace is provably unsafe. Finalize never regenerates an archived UAT.md (archive is `fs.rename`); the archive already receives post-rename writes (`gates.yaml`, `finalizer.ts:199-213`); nothing checksums archive contents.

**Recommended mutation algorithm (region-bounded + line-anchored):**
1. Read the document; the acceptance region ends at the first `^## UAT run — ` line (or EOF).
2. Reset: within the acceptance region only, rewrite lines exactly `- [x] Pass` → `- [ ] Pass`.
3. Execute steps; flip a step's own checkbox on genuine pass (Edit old-string must include the step heading + field lines for uniqueness).
4. Append `## UAT run — YYYY-MM-DD` at EOF: `**Runner**` (agent name + self-reported model, "unknown" fallback), `**Completed**` (full ISO-8601), `**Result**` counts, a per-step pass/fail/skip table (words, never checkbox syntax), and a `### Failures` subsection with expected-vs-observed detail.
5. Never touch prior run sections, step text, or Machine-verified annotations; never write results to any other file.

**Archive policy decision: Policy A — edit archived UAT.md in place, bounded to checkbox flips + appended run records.** Justification: the finalize-ship audit scenario reads UAT.md itself from the archive; leaving it permanently unchecked while truth lives elsewhere makes the artifact misleading; the gates.yaml precedent already writes into archives post-rename; nothing validates archive bytes. `docs/workflows/state.md:225` ("preserved verbatim") gets a one-clause touch-up during execution. Git history is the recovery layer, not the run history — the document must answer the acceptance question standalone (rejected git-log-as-history).

**Open risks accepted:** finalize re-run overwrite window (document only; finalizer is out of scope); same-day duplicate run headings (disambiguated by Completed timestamp); model self-report is unverifiable (labeled as such); old archived headers keep the superseded "do not edit" sentence — the agent contract notes the new wording governs.

## Consolidated recommendation

Build `/metta-uat` as a hook-less main-session skill (frontmatter per Track 2) spawning a `metta-uat-runner` agent (`tools: [Read, Bash, Edit]`, color green) that executes steps with the region-bounded + line-anchored mutation algorithm from Track 3, appends dated run records, and returns failures to the orchestrator for `/metta-issue` logging. The spec delta merges into a **net-new `uat-execution` capability** (H1 + marker edit applied). No CLI, guard-hook, install-code, or test-inventory changes; both template/deployed pairs land in the same commit; byte-identity is auto-covered by `tests/template-deploy-sync.test.ts`.
