# UAT: fix-instruction-payload-output-path-cwd-relative

- **Change**: fix-instruction-payload-output-path-cwd-relative
- **Generated**: 2026-08-08
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Emit `output_path` as an absolute, change-rooted path. In `instructions.ts`, the resolved `changeRoot` (already computed via `resolveChangeRoot`) is passed into `InstructionGenerator.generate()`, and `output_path` becomes `join(changeRoot, 'spec', 'changes', <name>, <generates>)`. In-worktree invocation is unchanged in substance: the absolute path resolves inside the worktree's own checkout.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Add an explicit `change_root` field to the instruction contract (`InstructionOutput`), carrying the absolute checkout root that hosts the change. This gives skills a single anchor for any change-scoped operation beyond the artifact write (e.g. reading sibling artifacts, git operations).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Update the consuming skills (`.claude/skills/metta-propose/SKILL.md`, `.claude/skills/metta-plan/SKILL.md`, and any other skill that interpolates `{output_path}`) so subagent prompts write the absolute `{output_path}` and run git against the hosting checkout — `git -C {change_root} add <path> && git -C {change_root} commit ...` — never the session cwd. A plain `git add {absolute-path}` from the main root would fail ("outside repository") for a worktree file, so the `-C {change_root}` form is required, not optional.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Audit other payload path fields consumed for writes (e.g. the constitution-check contract's `output_path`/`spec_path` consumed by `/metta-plan` step 3) and apply the same absolute, change-rooted emission.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Prefer the discovered worktree host over the stored one. In `ArtifactStore.getChange()`, when discovery finds a live host for the change, it wins over a persisted `metadata.worktree` value; the stored value is only used when discovery finds nothing. Write paths keep the existing never-persist-the-injected-host behavior.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.6
- **Do**: Confirm: Validate `--change` with `assertSafeSlug` in `complete.ts` and `instructions.ts` before any path join or store lookup, matching `context.ts`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.7
- **Do**: Confirm: Verify main-root lookup of worktree-hosted changes in `instructions`/`complete` with regression tests (change resolvable by `--change <name>` from the main root); fix the ENOENT if it reproduces against current source rather than a stale build.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Resolves issue `instruction-payload-output-path-is-cwd-relative-so-a-main` (major).

#### Step 2.1
- **Do**: Confirm: Absolute, change-rooted instruction payload paths (`b7999684c`)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: check-constitution contract re-rooted (`0fe59d3b3`)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: Skills consume the contract correctly (`4ed9459b6`)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: Slug validation in complete (`093c6055c`)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: Discovered worktree host wins over stored value (`1d4eb1b92`)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: Consumer tests updated for the deliberate breaking change (`ba212ef5f`)
- **Observe**: behaves as described
- [ ] Pass
