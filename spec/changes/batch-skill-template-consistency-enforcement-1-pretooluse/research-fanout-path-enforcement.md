# Fan-Out Path Enforcement Research: Review and Verify Steps

Change: `batch-skill-template-consistency-enforcement-1-pretooluse`
Scope: Enforce that parallel reviewer and verifier subagents write to `spec/changes/<name>/review/<persona>.md` and `spec/changes/<name>/verify/<aspect>.md` instead of `/tmp/` or in-context-only.

---

## Problem Characterization

The current `src/templates/skills/metta-propose/SKILL.md` (step 6 — REVIEW) explicitly instructs:

> "No reviewer writes to disk during its own turn."

The orchestrator is supposed to merge reviewer outputs into `review.md` from context alone. In practice, reviewers and verifiers do one of two things:
1. Return results in their agent response context without writing any file (the intended behavior, but results are lost if the orchestrator step fails or the session ends).
2. Write to `/tmp/` paths because nothing in the prompt forbids it and LLMs default to `/tmp/` for scratch files.

Archived changes show only a single merged `review.md` per change — no per-reviewer files (`correctness.md`, `security.md`, `quality.md`) have ever been written to the change directory in the project's history. This means either the context-merge approach is working (no disk persistence), or reviewer outputs are being silently dropped.

The spec (`ReviewFanOutPathsInTree`, `VerifyFanOutPathsInTree`) now requires:
- `spec/changes/<name>/review/correctness.md`, `review/security.md`, `review/quality.md`
- `spec/changes/<name>/verify/tests.md`, `verify/tsc-lint.md`, `verify/scenarios.md`

The analogous fix for the research fan-out (completed in `fix-three-issues-1-elevate-research-synthesis-numbered-step`) achieved compliance via explicit path mandate + `/tmp/` prohibition in prose — and the research approach files are confirmed present in `spec/changes/batch-skill-template-consistency-enforcement-1-pretooluse/research-*.md` for the current change.

---

## Approach 1: Prose-Only Mandate in SKILL.md

### Description

Replace the current "no reviewer writes to disk" instruction with an explicit path mandate and `/tmp/` prohibition, mirroring the proven research fan-out wording at SKILL.md line 70:

> "Each reviewer MUST write its findings to `spec/changes/<change>/review/<persona>.md` (correctness, security, quality). Forbid `/tmp/` paths — per-reviewer output MUST be in-tree so the orchestrator can merge it."

Same change for the verifier step. No orchestrator code changes.

### Compliance Risk

**Medium.** The research fan-out fix used this approach and it is working (research files are present in the current change directory). However, the research step had an additional structural advantage: the synthesis step immediately after creates a strong incentive to produce the files (without them, the synthesis step has nothing to read and is visibly broken). Review and verify do not have a synthesis step that fails loudly — the orchestrator could still merge from context and produce `review.md` without the individual files ever landing on disk. An LLM may comply with the prose mandate, or it may infer that writing to context is equivalent and skip the disk write.

The critical question is whether the LLM reads the subagent prompt carefully enough. The research fan-out demonstrates that with explicit prose, compliance rate is high for well-structured LLMs, but not guaranteed.

### Implementation Cost

**Minimal.** Two prose edits to `SKILL.md` (review step and verify step), plus update to the `.claude/skills/metta-propose/SKILL.md` mirror to maintain byte identity. Likely 10-20 lines changed. No orchestrator code, no new files, no test changes beyond the byte-identity check.

### Observability

**Low.** No mechanical check enforces the output. If a reviewer writes to `/tmp/` or returns results only in context, the orchestrator will still produce a `review.md` from whatever it received, and the session will continue without any error. The violation is only detectable by a human inspecting the `spec/changes/<name>/review/` directory afterward. The scenario test (`SKILL.md prose forbids /tmp for review`) is a grep-based check — it verifies the prose but not the runtime behavior.

---

## Approach 2: Prose + Post-Hoc Orchestrator Check

### Description

Add a verification gate in the SKILL.md orchestrator instructions: after the reviewer fan-out completes (all three agents return), the orchestrator checks whether `spec/changes/<name>/review/correctness.md`, `review/security.md`, and `review/quality.md` exist and are non-empty before proceeding to merge. If any are missing, the orchestrator aborts the review step with a clear error.

Same gate for the verify step.

Combined with the prose mandate from Approach 1 (both changes are additive).

### Compliance Risk

**Low.** The orchestrator gate enforces the contract mechanically — if a reviewer writes to `/tmp/` or returns in context only, the missing file check catches the failure before the merge step. The workflow does not proceed until the files land in the right place, providing a direct incentive for the subagent prompt to be re-issued or corrected.

### Implementation Cost

**Moderate.** Requires:
1. The same prose edits as Approach 1.
2. Additional orchestrator instructions in SKILL.md describing the post-fan-out check logic (roughly: "After all reviewers return, verify that `spec/changes/<name>/review/correctness.md`, `review/security.md`, and `review/quality.md` all exist and have non-zero size. If any are missing, do not proceed to the merge step — report the missing files and re-issue the affected reviewer agents.").
3. The check is expressed in prose, not code — the orchestrator LLM must execute the filesystem check via a Bash tool call (`test -s <path> && ...`).

Total SKILL.md addition: approximately 8-12 lines for the review gate plus 8-12 lines for the verify gate, on top of the Approach 1 changes.

### Observability

**High.** The failure is loud: if a reviewer does not write the required file, the orchestrator hits the gate, reports the specific missing path, and either retries or halts. The user sees a concrete error (`spec/changes/my-change/review/correctness.md missing or empty`) rather than a silently incomplete merge.

However, the gate is still prose-driven — the orchestrator LLM must choose to execute the check rather than skip it. A strongly-worded `SHALL NOT skip` with the same pattern used in the implementation pre-batch self-check (lines 80-86 of SKILL.md) significantly increases compliance rate.

---

## Approach 3: Pre-Fan-Out Directory Creation + Structural `<OUTPUT_FILE>` Tag

### Description

Before spawning reviewer agents, the orchestrator runs:

```bash
mkdir -p spec/changes/<name>/review
mkdir -p spec/changes/<name>/verify
```

Each subagent prompt includes an explicit output file tag:

```
<OUTPUT_FILE>spec/changes/<name>/review/correctness.md</OUTPUT_FILE>
```

with the instruction: "Write your complete review to the path in `<OUTPUT_FILE>`. Do not write to any other path. The file must exist and be non-empty when you return."

Combined with post-hoc check from Approach 2.

### Compliance Risk

**Low to very low.** The combination of (a) directory pre-existing on disk, (b) explicit tagged path in the subagent prompt, and (c) post-hoc existence check creates three independent enforcement layers. An LLM given a concrete absolute path in a structured tag is highly likely to write to it rather than inventing a different location. This is the most deterministic approach for path compliance.

The `<OUTPUT_FILE>` tag pattern is already used in the codebase's subagent prompt template section (SKILL.md line 218: "Write the file {output_path} following this template") — adding structural tags is consistent with existing patterns.

### Implementation Cost

**Higher.** Requires:
1. Prose edits (Approach 1).
2. Post-hoc gate (Approach 2).
3. Orchestrator instructions for the `mkdir -p` pre-step (2-3 lines in SKILL.md).
4. Updated subagent prompt template showing the `<OUTPUT_FILE>` tag pattern for reviewer and verifier spawns.

The subagent prompt template section at the bottom of SKILL.md (lines 241-256) must be updated or annotated to show how `<OUTPUT_FILE>` tags are used for these specific steps. This risks making the SKILL.md longer and harder to navigate.

Total added SKILL.md content: approximately 20-30 lines beyond Approach 1.

### Observability

**Very high.** Same as Approach 2 plus: the directory existence before fan-out starts provides a visual signal; the `<OUTPUT_FILE>` tag removes ambiguity from the subagent's perspective. If the subagent writes to a different path, the post-hoc check catches it.

---

## Tradeoff Table

| Criterion | Approach 1: Prose Only | Approach 2: Prose + Post-Hoc Check | Approach 3: mkdir + `<OUTPUT_FILE>` + Check |
|---|---|---|---|
| Compliance rate | Medium (relies on LLM reading prose) | High (explicit gate catches misses) | Very high (three enforcement layers) |
| Implementation cost | Minimal (prose edit) | Moderate (+8-12 lines per step) | Higher (+20-30 lines + template update) |
| SKILL.md length impact | Small | Moderate | Larger — risk of cognitive overload |
| Observability on failure | None (silent) | Loud (missing file error) | Loud (same as Approach 2) |
| Consistency with research fix | Direct match — same pattern used | Superset — adds gate research doesn't have | Further diverges from research step pattern |
| Implementation risk | Prose LLM drift | Orchestrator must execute check via Bash | Same as Approach 2, plus `mkdir` step |
| Analogous precedent in codebase | Yes — research fan-out (line 70) | Partial — pre-batch self-check (lines 80-86) | Partial — subagent prompt template (lines 244-246) |

---

## Key Observations from the Codebase

1. The research fan-out fix (line 70) used Approach 1 and it worked. Both `research-hook-strategy.md` and `research-bypass-mechanism.md` are present in the current change directory, demonstrating that prose mandate plus explicit path naming is sufficient for the research phase.

2. The research step has a natural enforcement: the synthesis step (step 4) reads `research-*.md` files and fails visibly if they are missing. The review and verify steps lack this natural downstream enforcement — the orchestrator can merge from context even if disk files are absent.

3. The pre-batch self-check pattern (SKILL.md lines 80-86) shows that explicit numbered `MUST` bullet points in the orchestrator's own flow significantly raise compliance for structural requirements. This is Approach 2's mechanism applied to implementation batching — and it works (batch execution is one of the areas where metta-propose has been most reliable).

4. The current review step instructs "no reviewer writes to disk" — this is the opposite of what is now required. Changing this to a disk-write mandate is a semantic reversal, not an additive change. This makes pure Approach 1 somewhat fragile: the LLM may retain the prior "context-only" behavior if the new prose is not sufficiently emphatic.

---

## Recommendation: Approach 2 — Prose Mandate + Post-Hoc Orchestrator Check

### Rationale

Approach 1 alone is insufficient here because the semantic reversal (from "no reviewer writes to disk" to "reviewer MUST write to disk") needs more than a single prose sentence to override an established pattern. The research step never had a "don't write to disk" instruction, so prose alone was enough. The review and verify steps do.

Approach 3 adds `mkdir -p` and `<OUTPUT_FILE>` tags. The directory pre-creation is genuinely useful — it eliminates a class of "path not found" write failures. However, the `<OUTPUT_FILE>` tag is not a Claude Code convention (it is a human-readable aid, not a structured protocol the runtime parses), so it reduces ambiguity but does not mechanically guarantee the write destination. The net gain over Approach 2 does not justify the additional SKILL.md complexity for this change.

Approach 2 achieves the necessary enforcement with moderate cost. The post-hoc check pattern is directly analogous to the pre-batch self-check that enforces parallel execution — the strongest enforcement mechanism currently in the SKILL.md. Applying the same numbered-`MUST`-bullets pattern to the review and verify gates gives the orchestrator a concrete, failure-loud mechanism that matches the project's established style.

The `mkdir -p` pre-step from Approach 3 SHOULD be included in Approach 2 as a one-line addition — it eliminates write-path errors with trivial cost and is worth adding regardless of the gate.

---

## Recommended SKILL.md Step 5 (REVIEW) Replacement — Copy-Paste Draft

Replace the current step 6 REVIEW block from `6. **REVIEW** ...` through the end of the REVIEW-FIX LOOP with the following. (Note: the numbering follows the current SKILL.md numbering where REVIEW is step 6; the spec references "step 5" by a different numbering scheme.)

```
6. **REVIEW** — **you MUST spawn all 3 metta-reviewer agents in a SINGLE orchestrator message** (fan-out — parallel, one message, three `Agent(...)` calls):

   **Pre-review setup (run BEFORE spawning reviewers):**
   Run `mkdir -p spec/changes/<change>/review` to ensure the output directory exists.

   **Pre-batch self-check — you MUST complete every bullet before emitting any reviewer `Agent(...)` call. SHALL NOT skip. No hedge words:**

   1. You MUST list the conceptual `Files` scope of each reviewer: all three read the same source tree and write to **distinct** output files in `spec/changes/<change>/review/`.
   2. You MUST classify the reviewer fan-out as **disjoint** — the three reviewers each write to a unique file path with no overlap.
   3. You MUST declare all 3 reviewers **Parallel**.
   4. Sequential is forbidden here because no reviewer writes a file that another reviewer also writes. If you believe a conflict exists, you MUST name the specific conflicting file path in writing; absent a named path, spawn in parallel.

   **Rule inversion — parallel is the default.** The three reviewers SHALL be emitted in one orchestrator message as three `Agent(...)` tool calls.

   **Fan-out anti-example — 3 reviewer agents:**

   ```wrong
   // Three separate messages. Correctness review finishes before security even
   // starts. Review latency triples for no reason.
   msg 1: Agent(subagent_type: "metta-reviewer", ...correctness...)
   msg 2: Agent(subagent_type: "metta-reviewer", ...security...)
   msg 3: Agent(subagent_type: "metta-reviewer", ...quality...)
   ```

   ```right
   // One message, three Agent calls. All three reviewers run concurrently.
   msg 1:
     Agent(subagent_type: "metta-reviewer", ...correctness...)
     Agent(subagent_type: "metta-reviewer", ...security...)
     Agent(subagent_type: "metta-reviewer", ...quality...)
   ```

   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**. Check logic errors, off-by-one, edge cases, spec compliance. Write your complete findings to `spec/changes/<change>/review/correctness.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**. Check OWASP top 10, XSS, injection, secrets. Write your complete findings to `spec/changes/<change>/review/security.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**. Check dead code, naming, duplication, test gaps. Write your complete findings to `spec/changes/<change>/review/quality.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."

   **Post-fan-out gate — MANDATORY before merge. SHALL NOT skip:**
   After all three reviewer agents return, YOU the orchestrator MUST run:
   ```bash
   test -s spec/changes/<change>/review/correctness.md && \
   test -s spec/changes/<change>/review/security.md && \
   test -s spec/changes/<change>/review/quality.md && \
   echo "REVIEW_FILES_OK" || echo "REVIEW_FILES_MISSING"
   ```
   If the output is `REVIEW_FILES_MISSING`, identify which file(s) are absent or empty, report the specific missing paths, and re-issue the affected reviewer agent(s) before proceeding. Do NOT merge from context alone if any file is missing — merge MUST read from the three on-disk files.

   - Merge `correctness.md`, `security.md`, and `quality.md` from `spec/changes/<change>/review/` into `spec/changes/<change>/review.md` and commit.
   - **REVIEW-FIX LOOP (repeat until clean):**
     a. If any critical issues found:
        - Parse each issue's file path from review.md
        - Group issues by file — independent files MUST be fixed in parallel (one metta-executor per file group, all spawned in the SAME orchestrator message)
        - Sequential fix-spawning is forbidden unless two issues share the same file path; in that case you MUST name the shared file in writing before serializing
     b. After fixes: re-run the 3 reviewers again (still one message, three `Agent(...)` calls), each writing to its respective `review/<persona>.md` path
     c. If new issues found: repeat from (a)
     d. If all 3 reviewers report PASS or PASS_WITH_WARNINGS: exit loop
     e. Max 3 iterations — if still failing after 3 rounds, stop and report to user
```

---

## Recommended SKILL.md Step 6 (VERIFY) Replacement — Copy-Paste Draft

Replace the current step 7 VERIFICATION block from `7. **VERIFICATION** ...` through "If any gate fails: ...":

```
7. **VERIFICATION** — **you MUST spawn all 3 metta-verifier agents in a SINGLE orchestrator message** (fan-out — parallel, one message, three `Agent(...)` calls):

   **Pre-verify setup (run BEFORE spawning verifiers):**
   Run `mkdir -p spec/changes/<change>/verify` to ensure the output directory exists.

   **Pre-batch self-check — you MUST complete every bullet before emitting any verifier `Agent(...)` call. SHALL NOT skip. No hedge words:**

   1. You MUST list each verifier's command/scope: Agent 1 runs `npm test`; Agent 2 runs `npx tsc --noEmit` and `npm run lint`; Agent 3 reads `spec.md` and cross-references tests. Each writes to a distinct output file in `spec/changes/<change>/verify/`.
   2. You MUST classify the verifier fan-out as **disjoint** — all three write to unique file paths with no overlap.
   3. You MUST declare all 3 verifiers **Parallel**.
   4. Sequential is forbidden here unless you can name a specific conflicting file path that two verifiers both write to. No such path exists in the default configuration; sequential verification in the default configuration is therefore forbidden.

   **Rule inversion — parallel is the default.** The three verifiers SHALL be emitted in one orchestrator message as three `Agent(...)` tool calls.

   **Fan-out anti-example — 3 verifier agents:**

   ```wrong
   // Three separate messages. The type-check sits idle while npm test runs;
   // wall-clock gate time is the sum instead of the max.
   msg 1: Agent(subagent_type: "metta-verifier", ...npm test...)
   msg 2: Agent(subagent_type: "metta-verifier", ...tsc + lint...)
   msg 3: Agent(subagent_type: "metta-verifier", ...spec traceability...)
   ```

   ```right
   // One message, three Agent calls. All three verifiers run concurrently.
   msg 1:
     Agent(subagent_type: "metta-verifier", ...npm test...)
     Agent(subagent_type: "metta-verifier", ...tsc + lint...)
     Agent(subagent_type: "metta-verifier", ...spec traceability...)
   ```

   - Agent 1 (subagent_type: "metta-verifier"): "Run `npm test` — report pass/fail count and failures. Write your complete output to `spec/changes/<change>/verify/tests.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."
   - Agent 2 (subagent_type: "metta-verifier"): "Run `npx tsc --noEmit` and `npm run lint` — report errors. Write your complete output to `spec/changes/<change>/verify/tsc-lint.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."
   - Agent 3 (subagent_type: "metta-verifier"): "Read spec.md, check each Given/When/Then scenario has a passing test — cite evidence. Write your complete output to `spec/changes/<change>/verify/scenarios.md`. MUST NOT write to /tmp or return results only in context — the file must exist on disk when you return."

   **Post-fan-out gate — MANDATORY before merge. SHALL NOT skip:**
   After all three verifier agents return, YOU the orchestrator MUST run:
   ```bash
   test -s spec/changes/<change>/verify/tests.md && \
   test -s spec/changes/<change>/verify/tsc-lint.md && \
   test -s spec/changes/<change>/verify/scenarios.md && \
   echo "VERIFY_FILES_OK" || echo "VERIFY_FILES_MISSING"
   ```
   If the output is `VERIFY_FILES_MISSING`, identify which file(s) are absent or empty, report the specific missing paths, and re-issue the affected verifier agent(s) before proceeding. Do NOT merge from context alone if any file is missing — merge MUST read from the three on-disk files.

   - Merge `tests.md`, `tsc-lint.md`, and `scenarios.md` from `spec/changes/<change>/verify/` into `spec/changes/<change>/verify.md` (or `summary.md`) and commit.
   - If any gate fails: spawn parallel metta-executors to fix (all fixes in ONE orchestrator message unless two fixes share a file path you have named in writing), then re-run the verifier fan-out with the same `mkdir -p` pre-step and post-fan-out gate.
```

---

## Implementation Notes for the Executor

1. Both SKILL.md files must be updated: `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md`. They must remain byte-identical (checked by `tests/skill-discovery-loop.test.ts`).

2. The `<change>` placeholder in the draft text above is a literal template variable — implementers should not expand it; the orchestrator substitutes the actual change name at runtime, exactly as it does today in other step prose.

3. The post-fan-out gate uses `test -s` (non-zero size) rather than `test -f` (file exists), since an empty file would pass a `-f` check but still represent a failed output.

4. The `mkdir -p` pre-step is idempotent and safe to include unconditionally. If the directory already exists (e.g., from a prior run in the REVIEW-FIX LOOP), it succeeds silently.

5. The `verify.md` merge target: the current SKILL.md step 7 refers to "summary.md" at line 191. The spec (`VerifyFanOutPathsInTree`) targets `verify.md`. The draft text above uses `verify.md` to match the spec; reconcile with the existing `summary.md` reference when applying the edit.

---

## Summary

**Chosen approach:** Approach 2 — Prose mandate combined with post-hoc orchestrator existence check, augmented with a `mkdir -p` pre-step from Approach 3.

**One-line justification:** The post-hoc gate gives the orchestrator a loud, actionable failure signal that pure prose cannot, at moderate implementation cost — avoiding the silent context-only path that the current "no reviewer writes to disk" instruction has normalized.
