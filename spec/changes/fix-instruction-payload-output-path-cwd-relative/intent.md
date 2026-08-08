# fix-instruction-payload-output-path-cwd-relative

## Problem

The instruction payload's `output_path` is a cwd-relative string. `InstructionGenerator.generate()` (src/context/instruction-generator.ts:133) emits `output_path: 'spec/changes/<name>/<file>'`, and the skills consume it verbatim from the session's working directory — `.claude/skills/metta-propose/SKILL.md` (lines 303/330/338) and `.claude/skills/metta-plan/SKILL.md` (lines 43/50) instruct subagents to "Write the file {output_path}" and "git add {output_path} && git commit".

For a worktree-hosted change driven from the main checkout root, this is wrong in both halves: the artifact is written to `<main-root>/spec/changes/<name>/<file>` — a directory the worktree checkout never sees — and the follow-up `git add`/`git commit` lands it on the main branch's index instead of the change's worktree branch. The prior fix (`fix-root-invoked-instructions-context-complete-emit-main`) re-rooted `changePath`, `specDir`, and the git side-effect cwds inside the CLI via `resolveChangeRoot`, but explicitly scoped `output_path` out, so the contract handed to the AI orchestrator still points at the wrong tree.

Who is affected: every AI-orchestrated session (the default operating mode of this project) that drives a worktree-hosted change from the main root — which is exactly how `/metta-propose` sessions behave after worktree-per-change landed. The blast radius today is a loud failure rather than silent corruption: worktree-aware `metta complete` looks for the artifact in the change's real host and fails with "artifact not found". That mitigation stops bad state from being validated, but the workflow still dead-ends, the artifact and a commit still pollute the main checkout, and a human has to untangle it (this has happened — see the "drop stray change dir from wrong-branch incident" commit on main).

Two adjacent defects from the same correctness review share the root cause (change-scoped path resolution at the CLI boundary) and are folded in:

- **Stale stored worktree path wins over the discovered host.** `ArtifactStore.getChange()` (src/artifacts/artifact-store.ts:145-147) only injects the discovered host when `metadata.worktree` is undefined; a persisted absolute `worktree` value (written by propose) always wins. After a repo move or cross-machine resume the stored path is stale, and `resolveChangeRoot`'s containment guard then silently falls back to the project root — reintroducing exactly the wrong-tree class of bug this change exists to kill.
- **Missing slug validation on `--change`.** `complete.ts` and `instructions.ts` pass the user-supplied `--change` argument into `join('spec', 'changes', changeName)` and store lookups without `assertSafeSlug`, unlike `context.ts:50`. A `../..`-shaped change name could traverse outside the spec tree.

Live evidence also shows `metta instructions intent --json --change <name>` invoked from the main root failing with ENOENT on `<main-root>/spec/changes/<name>/.metta.yaml` for a worktree-hosted change, even though `createCliContext` wires worktree discovery into the store. Main-root lookup for worktree-hosted changes must be verified (and fixed if the repro holds) as part of this change — it is the same root-invocation correctness family.

## Proposal

Make every path the instruction contract hands to a consumer unambiguous regardless of the invoking session's cwd, and close the two adjacent path-resolution defects.

1. **Emit `output_path` as an absolute, change-rooted path.** In `instructions.ts`, the resolved `changeRoot` (already computed via `resolveChangeRoot`) is passed into `InstructionGenerator.generate()`, and `output_path` becomes `join(changeRoot, 'spec', 'changes', <name>, <generates>)`. In-worktree invocation is unchanged in substance: the absolute path resolves inside the worktree's own checkout.
2. **Add an explicit `change_root` field to the instruction contract** (`InstructionOutput`), carrying the absolute checkout root that hosts the change. This gives skills a single anchor for any change-scoped operation beyond the artifact write (e.g. reading sibling artifacts, git operations).
3. **Update the consuming skills** (`.claude/skills/metta-propose/SKILL.md`, `.claude/skills/metta-plan/SKILL.md`, and any other skill that interpolates `{output_path}`) so subagent prompts write the absolute `{output_path}` and run git against the hosting checkout — `git -C {change_root} add <path> && git -C {change_root} commit ...` — never the session cwd. A plain `git add {absolute-path}` from the main root would fail ("outside repository") for a worktree file, so the `-C {change_root}` form is required, not optional.
4. **Audit other payload path fields consumed for writes** (e.g. the constitution-check contract's `output_path`/`spec_path` consumed by `/metta-plan` step 3) and apply the same absolute, change-rooted emission.
5. **Prefer the discovered worktree host over the stored one.** In `ArtifactStore.getChange()`, when discovery finds a live host for the change, it wins over a persisted `metadata.worktree` value; the stored value is only used when discovery finds nothing. Write paths keep the existing never-persist-the-injected-host behavior.
6. **Validate `--change` with `assertSafeSlug`** in `complete.ts` and `instructions.ts` before any path join or store lookup, matching `context.ts`.
7. **Verify main-root lookup of worktree-hosted changes** in `instructions`/`complete` with regression tests (change resolvable by `--change <name>` from the main root); fix the ENOENT if it reproduces against current source rather than a stale build.

Tests: extend `instruction-generator` and command tests to assert absolute `output_path`/`change_root` for both worktree-hosted and local changes; artifact-store tests for discovered-host-wins; slug-rejection tests for both commands. Update the `instruction-contracts` spec delta for the changed field semantics.

## Impact

- **Instruction contract (`instruction-contracts` capability):** `output_path` changes from a repo-relative string to an absolute path, and `change_root` is added. Any consumer that assumed relative semantics — the skill templates listed above, and any user-authored automation parsing `--json` output — must switch. This is the deliberate breaking change of this fix; the spec delta documents it.
- **Skills:** `metta-propose` and `metta-plan` prompt templates change their write/commit instructions. Other skills that echo `output_path` (constitution-check flow in `/metta-plan`) change accordingly.
- **`ArtifactStore.getChange()` host precedence:** consumers of the transient `worktree` field (status/list/`resolveChangeRoot` callers) now see the discovered host when it differs from a stored value. On a moved repo, behavior changes from silent-fallback-to-main-root to correct worktree targeting.
- **`metta complete` / `metta instructions` argument handling:** malformed change names now fail fast with a slug error (exit 4) instead of attempting a traversing path join. Legitimate slugs are unaffected.
- **Human CLI users:** plain (non-`--json`) `instructions` output prints an absolute `Output:` path instead of a relative one — cosmetic.
- **Unchanged:** the invoking session's config anchoring (`.metta/config.yaml` at the main root still governs model resolution), workflow loading, the `metta complete` artifact-not-found guard (which should now simply stop firing for this scenario), and all in-worktree invocation flows.

## Out of Scope

- Re-rooting config loading or workflow lookup — main-root anchoring of `.metta/config.yaml` and workflow definitions is deliberate and stays.
- Any change to the worktree lifecycle itself (creation, pruning, branch naming, `DEFAULT_WORKTREE_DIR` layout).
- Cross-machine resume support beyond preferring the discovered host — no path rewriting, no persisted-path migration of existing `.metta.yaml` files.
- Cleaning up artifacts/commits already misplaced in the main checkout by past occurrences of this bug — manual/one-off, not framework behavior.
- Guard-hook (`metta-guard-bash`) or skill-authorization changes.
- A general relative-vs-absolute audit of JSON fields not consumed for filesystem writes (e.g. display-only fields, `next_command` strings).
- Slug validation in commands other than `complete` and `instructions` (`context.ts` already has it; a repo-wide sweep is a separate hardening pass).
