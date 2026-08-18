# Research: Agent-Template and Skill-Contract Path Discipline

> Approach: amend executor/verifier agent templates and executor-dispatching skill
> instructions to (a) require change_root-anchored paths for shell writes, (b) forbid
> absolute-path writes outside change_root, and (c) mandate STOP-and-report on
> silent-write anomalies instead of bash-script fallbacks.
> Covers intent Proposal 1 / spec requirements: "Executor Shell Writes Are Anchored Under
> change_root", "Silent-Write Anomaly Triggers STOP-and-Report", "Verifier Carries the Same
> Shell-Write Path Discipline", "Execute Skill Contract Binds Executors to Path Discipline".

## Current State

### Executor template has zero path discipline

`src/templates/agents/metta-executor.md` (29 lines total) never mentions `change_root`.
Its Rules section (lines 22–28) covers test-running, commit format, task scope, and
tasks.md protection — nothing about where bash writes may land:

- Line 26: "Do NOT modify files outside the task's declared scope without logging a
  deviation" — scope is task-relative, not checkout-relative; it does not prevent
  resolving a scoped file against the wrong checkout.
- Deviation Rules (lines 14–20) enumerate 5 STOP/fix conditions; none covers a
  tool-success/disk-mismatch anomaly. Rule 3/4 STOPs are for infra blocks and design
  errors — an executor seeing edits "not land" matches neither, which is exactly why the
  zeus executor improvised a bash fallback.

`grep change_root src/templates/agents/*.md` returns no hits in metta-executor.md: the
entire change_root contract lives one level up, in orchestrator skill prompts.

### The skills pass change_root into prompts, but the binding is one-sided

- `src/templates/skills/metta-execute/SKILL.md:48` — "Pass the payload's `change_root`
  into every executor prompt: all file paths handed to an executor must be absolute under
  `{change_root}`, and all commits it makes must use `git -C "{change_root}"`". This binds
  the *orchestrator* to hand over correct paths; nothing binds the *executor* to stay
  inside them when it authors its own bash commands.
- Same pattern in `metta-quick/SKILL.md:95`, `metta-auto/SKILL.md:51`,
  `metta-fix-issues/SKILL.md:54`, `metta-fix-gap/SKILL.md` (implementation loop),
  `metta-propose/SKILL.md:124+` (implementation phase).
- `metta-execute/SKILL.md:65` already has a "STOP handling (orchestrator)" paragraph —
  but only for model-escalation re-invocation after deviation STOPs. There is no handling
  for a silent-write STOP, and no prohibition on working around one.

### Verifier template actively sanctions a heredoc fallback

`src/templates/agents/metta-verifier.md:63` instructs: "ATTEMPT the Write tool first...
When Write is refused, fall back to writing the artifact via a shell heredoc (e.g.
`cat <<'EOF' > <path>`) to the EXACT mandated path". This is the *refusal* fallback
(explicit `tool_use_error` from the harness) — a legitimately different trigger from the
zeus incident's *silent success*. But the template never distinguishes the two, so a
verifier observing success-without-effect could plausibly read line 63 as license to
heredoc. The fallback target is "the EXACT mandated path" (orchestrator-provided
`output_path`), which is change_root-anchored in practice but not stated as a rule.

This exact wording is pinned by `tests/agents-byte-identity.test.ts:19–28`, which asserts
three literal strings in both the template and the deployed copy: `'ATTEMPT the Write
tool first.'`, `'When Write is refused, fall back to writing the artifact via a shell
heredoc'`, `'Never skip the artifact and never relocate it'`. Any rewording must preserve
these strings or update the test.

### Adjacent personas share partial risk

- `src/templates/agents/metta-reviewer.md` — holds `[Read, Write, Bash, Grep, Glob]`
  (line 4) and instructs output to a **relative** path: "Write a review to
  `spec/changes/<change>/review.md`" (line 23). In a worktree-hosted change with session
  cwd at the main checkout, that relative path resolves into the MAIN checkout's spec
  tree. Lower blast radius (never modifies implementation code, line 50), but it is a
  real cross-checkout write vector.
- `src/templates/agents/metta-specifier.md:21` and `metta-uat-runner.md:21` both sanction
  heredoc fallbacks on Write/Edit *refusal*. Both anchor to exact orchestrator-provided
  paths, so risk is lower, but neither distinguishes refusal from silent success.

### Template → installed sync path (where edits must land)

- Build: `package.json:18` `copy-templates` copies `src/templates/{skills,agents,hooks,...}`
  → `dist/templates/...` at build time; `dist/` is generated, not committed — no manual
  edit needed there.
- Consumer install: `src/delivery/command-installer.ts:11–58` (`installCommands`) copies
  `dist/templates/skills/*` → `.claude/skills/` and `dist/templates/agents/*.md` →
  `.claude/agents/` in the target project.
- Metta's own repo commits deployed copies under `.claude/`, and
  `tests/template-deploy-sync.test.ts:21–27` enforces **byte-identity** for the families
  `agents`, `skills`, `hooks`, `statusline` (auto-discovered file lists, `src/templates/X`
  vs `.claude/X`). Verified today: `metta-executor.md`, `metta-verifier.md`, and all
  relevant SKILL.md files are currently byte-identical between template and deployed copy.
  **Consequence: every template edit must be mirrored into the `.claude/` twin in the same
  change or `npm test` fails** — the sync mechanism is a hard test gate, not a script.

## Options Considered

### Option A — Persona-primary, execute-skill contract, one-line escalation in sibling skills (recommended)

Full path-discipline + STOP rules live in the two agent personas (`metta-executor.md`,
`metta-verifier.md`). The persona file is loaded for **every** spawn of that agent type
regardless of which skill dispatched it, so prevention travels everywhere automatically.
The `metta-execute` skill gets the full spawn-contract + escalation text (spec
requirement). The other executor-dispatching skills (`quick`, `auto`, `fix-issues`,
`fix-gap`, `propose`, `verify`) each get one identical escalation sentence so their
orchestrators also know a silent-write STOP is escalate-only.

- Pros: single source of truth for executor behavior; prevention coverage is complete by
  construction; skill-side additions are one line each; satisfies every spec scenario.
- Cons: 12 additional files touched for the sibling-skill one-liners (template + deployed
  each); no automated cross-skill consistency check (byte-identity is per-file
  template↔deployed only).

### Option B — Minimum spec compliance: personas + metta-execute only

Amend only `metta-executor.md`, `metta-verifier.md`, `metta-execute/SKILL.md` (and their
deployed twins). 6 files.

- Pros: smallest diff; satisfies the literal spec scenarios.
- Cons: an orchestrator running `/metta-quick`, `/metta-auto`, or `/metta-fix-issues`
  (all of which run their own implementation loops without ever loading the
  metta-execute skill — confirmed: each embeds its own executor-spawn steps) receives a
  silent-write STOP with no instruction on how to react. The zeus incident happened in
  exactly such a full-lifecycle run. The workaround the spec forbids ("re-dispatch with
  bash-write instructions") remains uninstructed-against in the most common entry points.

### Option C — Duplicate the full contract into every executor-dispatching skill

- Pros: maximally explicit at every entry point.
- Cons: ~7 copies of a multi-paragraph contract; guaranteed wording drift over time (the
  byte-identity test does not compare across skills); bloats every orchestrator context;
  no marginal safety over Option A because the executor persona already carries the rules.

## Proposed Design (Option A)

### 1. `metta-executor.md` — new Deviation Rule 6 + new Rules entries

**Deviation Rule 6** (append after Rule 5, line 20):

> - **Rule 6**: Silent-write anomaly — an `Edit`/`Write` call reports success but the
>   change is not on disk (verified via Bash, see Shell-Write Path Discipline) → STOP
>   immediately. Report the target path(s), which tool reported success, and the evidence
>   the write did not land. NEVER rewrite the content via bash (heredoc, redirection,
>   script) — that fallback has previously contaminated a main checkout.

**New `## Shell-Write Path Discipline` section** (between Deviation Rules and Rules —
keeping the existing Rules list additive-only per the "Existing executor rules are
preserved" scenario):

> - The `change_root` in your prompt is the only authoritative root for this change.
>   Never re-derive target paths from the session cwd, `git rev-parse`, or your own
>   reading of the repository layout when a prompt-provided `change_root` exists.
> - Every file write you perform via Bash — output redirection (`>`, `>>`), heredoc,
>   `tee`, `cp`, `mv`, or any script you author and run — MUST target an absolute path
>   under `change_root`. Writing via Bash to any path outside `change_root` is forbidden.
> - If your prompt carries no `change_root`, do not perform bash file writes at all —
>   report back and ask the orchestrator for it.
> - **Write verification comes free at commit time**: your per-task
>   `git -C "{change_root}" add … && git commit` doubles as verification. If git reports
>   nothing to commit after Edit/Write claimed success, first confirm via Bash (`grep` for
>   a line you added, or `cat` the file) that the intended content is genuinely absent —
>   a no-op edit (content already present) is not an anomaly. A confirmed absence is a
>   silent-write anomaly: apply Deviation Rule 6.

Rationale for the verification mechanism: mandating a re-`Read` after every Edit would
cost roughly a full-file read per edit across every executor spawn, and it is not certain
the Read tool observes disk truth in the failing harness state (the incident shows the
harness's own success report is untrustworthy, and Read may share that view). Bash
(`git status --porcelain`, `grep`, `cat`) is an independent disk-truth channel, and the
`git status`/commit step **already exists** in the executor's per-task loop — so the
mandatory check adds near-zero tokens. Explicit `grep`/`cat` confirmation is required only
on suspicion, which also handles the no-op-edit false-positive. This makes worktree-scoped
conditional verification unnecessary: the check is cheap enough to be universal, and
executors would otherwise need fragile heuristics ("does change_root contain
`.metta/worktrees/`?") to decide when to verify.

### 2. `metta-verifier.md` — same discipline + refusal/silent-success split

Add the same Shell-Write Path Discipline section (adapted: the verifier's only sanctioned
write is the verification artifact), and amend line 63 by **appending** (not rewording —
preserving the three strings pinned by `tests/agents-byte-identity.test.ts:23–27`):

> The heredoc fallback applies ONLY to an explicit refusal — a `tool_use_error` returned
> by the Write tool. It NEVER applies to a silent-write anomaly (Write/Edit reports
> success but the file on disk is missing or unchanged, verified via Bash `cat`): in that
> case STOP and report the target path and the success-without-effect observation to the
> orchestrator instead of writing via bash. When the refusal fallback is used, the heredoc
> target MUST be the exact orchestrator-provided path under `change_root` — never a
> re-derived path.

This split is what lets the template satisfy the spec scenario "no sanctioned
bash-fallback path [for a non-landing Edit/Write]" while keeping the deliberate,
separately-motivated refusal fallback (which recovers from a *different* failure where the
tool never claimed success and disk state is not in doubt).

### 3. `metta-execute/SKILL.md` — spawn contract + STOP escalation

- Extend the spawn-contract paragraph (line 48): after "all commits it makes must use
  `git -C "{change_root}"`", add: "Executors are bound by change_root shell-write path
  discipline: every bash-mediated file write must target an absolute path under
  `{change_root}` — include the `change_root` value in every executor prompt for this
  reason."
- Add a second STOP-handling paragraph beside the existing one (line 65):

> **Silent-write STOP handling (orchestrator):** when an executor STOP-reports a
> silent-write anomaly (Edit/Write reported success but the file on disk was unchanged),
> ESCALATE to the user immediately with the executor's report (target path,
> success-without-effect observation). Do NOT work around it: do not re-dispatch the
> executor with instructions to write via bash, and do not perform the write yourself —
> in or outside the worktree. This anomaly indicates a harness-level fault; only the user
> can decide to continue (e.g. restart the session).

- Deviation Rules block (lines 58–63, "include in every executor subagent prompt"): add
  Rule 6's one-line form so re-prompted executors carry it even when an orchestrator
  paraphrases rather than relying on the persona file.

### 4. Sibling skills — one-line escalation rule

Add one identical sentence to the Rules (or STOP-handling) section of `metta-quick`,
`metta-auto`, `metta-fix-issues`, `metta-fix-gap`, `metta-propose`, and `metta-verify`
SKILL.md:

> - If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success
>   with no on-disk effect), escalate to the user with the report; never work around it
>   via bash writes or orchestrator-performed writes.

`metta-next`, `metta-plan`, `metta-init` only route/mention agent types and never run an
implementation loop — no edit needed there.

### 5. Tests

Following the content-pin pattern of `tests/agents-byte-identity.test.ts:19–28`
(`it.each` over template + deployed path):

- Pin the executor path-discipline markers (e.g. `'MUST target an absolute path under'`,
  `'Rule 6'`, the bash-fallback prohibition) in both `src/templates/agents/metta-executor.md`
  and `.claude/agents/metta-executor.md`.
- Pin the verifier refusal/silent-success split.
- Pin the execute-skill escalation paragraph in both skill trees (the
  `tests/skill-template-anchoring.test.ts` SKILL_TREES pattern, line 20, shows the
  precedent for asserting over `.claude/skills` + `src/templates/skills`).
- Byte-identity template↔deployed is already auto-covered by
  `tests/template-deploy-sync.test.ts` (auto-discovers every file; no test change needed
  for sync).
- The "existing rules preserved" scenario is naturally verified by making every edit
  additive; a snapshot-style assertion is unnecessary — reviewers diff the template.

## Complete File List (this approach's slice)

Required by spec (6 files):

| # | Template | Deployed twin (byte-identity enforced) |
|---|----------|----------------------------------------|
| 1 | `src/templates/agents/metta-executor.md` | `.claude/agents/metta-executor.md` |
| 2 | `src/templates/agents/metta-verifier.md` | `.claude/agents/metta-verifier.md` |
| 3 | `src/templates/skills/metta-execute/SKILL.md` | `.claude/skills/metta-execute/SKILL.md` |

Recommended additive one-liners (12 files):

| # | Template | Deployed twin |
|---|----------|---------------|
| 4 | `src/templates/skills/metta-quick/SKILL.md` | `.claude/skills/metta-quick/SKILL.md` |
| 5 | `src/templates/skills/metta-auto/SKILL.md` | `.claude/skills/metta-auto/SKILL.md` |
| 6 | `src/templates/skills/metta-fix-issues/SKILL.md` | `.claude/skills/metta-fix-issues/SKILL.md` |
| 7 | `src/templates/skills/metta-fix-gap/SKILL.md` | `.claude/skills/metta-fix-gap/SKILL.md` |
| 8 | `src/templates/skills/metta-propose/SKILL.md` | `.claude/skills/metta-propose/SKILL.md` |
| 9 | `src/templates/skills/metta-verify/SKILL.md` | `.claude/skills/metta-verify/SKILL.md` |

Plus new/extended test file(s) under `tests/` (e.g. extend
`tests/agents-byte-identity.test.ts` and `tests/skill-template-anchoring.test.ts`, or a
new `tests/shell-write-path-discipline.test.ts` to keep the 1:1 ratio). `dist/` needs no
manual edit (regenerated by `copy-templates`, package.json:18).

## Edge Cases

1. **No-op edits** — `git status` showing nothing to commit is not proof of a silent
   write; the edit may have been a no-op (content already correct). The rule requires a
   Bash `grep`/`cat` confirmation before declaring the anomaly, preventing false STOPs.
2. **Refusal vs silent success** — the verifier's (and uat-runner's/specifier's)
   sanctioned heredoc fallback triggers on an explicit `tool_use_error`; the forbidden
   fallback triggers on claimed success without effect. Templates must state the
   distinction or an inspection could read the refusal fallback as violating the
   "no sanctioned bash-fallback path" scenario.
3. **Missing change_root in the prompt** — older orchestrator phrasings or ad-hoc spawns
   may omit it. The rule degrades safely: no bash file writes at all until the executor
   obtains change_root; Edit/Write to orchestrator-given absolute paths remain allowed.
4. **Legitimate tool side-writes** — `npm test`, `tsc`, coverage tools write to
   `node_modules/`, cache dirs, etc. The rule scopes to writes the agent *directs* at a
   path (redirection, heredoc, `tee`, `cp`, `mv`, self-authored scripts), not to the
   internal behavior of build/test commands. This also means scratch writes to `/tmp` by
   the executor become forbidden — acceptable; executors have no legitimate need, and
   layer 2 (guard-bash) would not have caught /tmp anyway.
5. **Parallel batch with one STOP** — orchestrators already wait for all executors in a
   batch (metta-execute step 4d); the escalation paragraph fires after the batch returns,
   so a STOP in one executor does not orphan its siblings; the orchestrator just must not
   start the next batch.
6. **Pinned test strings** — `tests/agents-byte-identity.test.ts:23–27` pins three exact
   verifier sentences; the amendment strategy (append, don't reword) keeps them passing.
7. **Reviewer relative path** (adjacent, out of this change's spec): `metta-reviewer.md:23`
   directs a write to relative `spec/changes/<change>/review.md` with Bash+Write in hand —
   a cross-checkout vector if the reviewer writes from the main-checkout cwd. The spec
   delta names only executor and verifier; recommend logging a follow-up issue
   (reviewer + specifier + uat-runner path-anchoring parity) rather than widening this
   change. In current practice orchestrators merge reviewer findings themselves
   (metta-quick step 7 note: "No reviewer writes to disk during its own turn"), so the
   live exposure is low.

## Risks and Tradeoffs

- **Instructions are soft enforcement.** An executor can still disobey persona rules —
  this layer reduces probability; layers 2 (guard-bash write-target blocking) and 3
  (main-checkout tree-clean detection) in this same change provide the hard backstops.
  This approach should not be shipped as the *only* layer.
- **Autonomy → correctness trade.** STOP-and-report converts a previously "self-healing"
  executor into one that halts the pipeline. That is the intended trade (per intent
  Impact), but users will see more mid-run escalations if the harness bug recurs.
- **Persona/prompt token growth.** ~15 lines per executor spawn and ~8 per verifier spawn;
  negligible against typical task prompts, and far cheaper than mandated per-edit
  re-reads (rejected above).
- **Cross-skill wording drift.** The six one-liners have no consistency test across
  skills; a content-pin test asserting the identical sentence in all six files (both
  trees) closes this cheaply.
- **False-STOP cost.** Mis-diagnosed anomalies (edge case 1) stall a run; the
  confirm-via-grep step bounds this to genuinely ambiguous states.

## Recommendation

**Option A.** Put the full shell-write path discipline and Rule-6 STOP contract in the
executor and verifier personas (prevention travels with every spawn, single source of
truth), the full spawn-contract + escalation text in `metta-execute/SKILL.md` (spec
requirement), and one identical escalation sentence in the six other executor-dispatching
skills — because `quick`/`auto`/`fix-issues`/`fix-gap`/`propose` run their own
implementation loops without ever loading the execute skill, and the zeus incident
occurred in exactly such a run. Verify writes via the already-existing per-task
`git -C "{change_root}" status/commit` step plus on-suspicion Bash `grep`/`cat`
(disk-truth channel, near-zero added tokens) rather than mandatory re-Reads. Amend the
verifier's sanctioned heredoc fallback additively to scope it to explicit refusals with
change_root-anchored targets, preserving the strings pinned in
`tests/agents-byte-identity.test.ts`. Every template edit lands in its `.claude/` twin in
the same commit (byte-identity test gate); `dist/` is handled by the build. Log a
follow-up issue for reviewer/specifier/uat-runner path-anchoring parity rather than
widening this delta.
