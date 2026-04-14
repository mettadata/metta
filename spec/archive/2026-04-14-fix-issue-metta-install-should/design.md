# Design: fix-issue-metta-install-should

## Approach

Remove `runRefresh` from `install.ts` entirely and relocate CLAUDE.md generation to the `/metta:init` skill orchestrator as an explicit post-step after the discovery agent commits `spec/project.md`. The discovery agent loses responsibility for CLAUDE.md (remove it from its `git add` line); the skill gains a two-operation post-step: run `metta refresh` via Bash, then stage and commit `CLAUDE.md` separately. Four files change across two logical pairs — each pair must be kept byte-identical (template source and deployed copy).

---

## Components

### `src/cli/commands/install.ts`

**Before (lines 177-183 and line 188):**

```typescript
// Generate CLAUDE.md using the same code as metta refresh
try {
  const { runRefresh } = await import('./refresh.js')
  await runRefresh(root, false)
} catch {
  // Refresh failure doesn't block init
}

// line 188:
await execAsync('git', ['add', '.metta/', 'spec/', 'CLAUDE.md'], { cwd: root })
```

**After:**

Lines 177-183 deleted in full. Line 188 becomes:

```typescript
await execAsync('git', ['add', '.metta/', 'spec/'], { cwd: root })
```

No import changes needed — the dynamic `import('./refresh.js')` was the only reference and it lives inside the deleted block.

---

### `src/templates/skills/metta-init/SKILL.md` and `.claude/skills/metta-init/SKILL.md`

Both files are byte-identical. The change inserts a new step 3a between the current step 3 (spawn discovery agent) and step 4 (report to user).

**Before (step 4 at end of Steps section):**

```
4. Report to user what was generated
```

**After:**

```
3a. After the discovery agent returns, run in Bash:
    ```
    metta refresh
    ```
    Then stage and commit CLAUDE.md separately:
    ```
    git add CLAUDE.md && git commit -m "chore: generate CLAUDE.md from discovery"
    ```

4. Report to user what was generated
```

Both files must receive the identical edit. The template at `src/templates/skills/metta-init/SKILL.md` is the source of truth; the deployed copy at `.claude/skills/metta-init/SKILL.md` must be kept in sync.

---

### `src/templates/agents/metta-discovery.md` and `.claude/agents/metta-discovery.md`

Both files are byte-identical. The only change is on line 28 of each file — the `git add` instruction.

**Before:**

```
- When done: `git add spec/project.md CLAUDE.md .metta/config.yaml && git commit -m "docs: generate project constitution"`
```

**After:**

```
- When done: `git add spec/project.md .metta/config.yaml && git commit -m "docs: generate project constitution"`
```

`CLAUDE.md` is removed from the agent's commit. The agent's role is now scoped strictly to writing `spec/project.md` and `.metta/config.yaml`. The skill's post-step owns CLAUDE.md.

The "## Your Role" description block also mentions generating `CLAUDE.md` — update to remove that claim:

**Before:**

```
You discover project context through structured questions and generate the project constitution (spec/project.md) and AI context file (CLAUDE.md).
```

**After:**

```
You discover project context through structured questions and generate the project constitution (spec/project.md) and project config (.metta/config.yaml).
```

---

## Data Model / API Design

No schema changes. The JSON output object from `install --json` (lines 199-209 of `install.ts`) does not contain a `claude_md` key today — confirmed by inspection. No fields are added or removed. The `outputJson` call is unchanged.

No CLI surface changes. `metta install`, `metta init`, and `metta refresh` command signatures are unchanged.

---

## Dependencies

No new dependencies are introduced.

`metta refresh` is already a registered CLI command (`src/cli/commands/refresh.ts`). The skill calls it via `Bash` tool (`metta refresh`), which resolves through the installed CLI binary — the same mechanism used for `metta init --json` in step 1 of the skill. No dynamic import from within skill prose is required.

`runRefresh` signature `(projectRoot: string, dryRun: boolean)` is unchanged. `refresh.ts` is not modified.

---

## Risks & Mitigations

**Risk: Existing installed projects have CLAUDE.md already; re-running `metta install` no longer overwrites it.**
Mitigation: This is the desired behavior. CLAUDE.md was previously overwritten unconditionally by `runRefresh`, which was a bug (intent.md problem 3). The file is now stable across re-installs. Users wanting to refresh can run `metta refresh` directly.

**Risk: Install commit previously staged CLAUDE.md implicitly. Removing it means the install commit is smaller and CLAUDE.md is absent until `/metta:init` completes.**
Mitigation: This is intentional per the split-metta-install-metta-init boundary. Any documentation stating "CLAUDE.md is created by `metta install`" is out of scope for this change but should be tracked as a follow-up documentation task. No code paths depend on CLAUDE.md existing post-install; `metta init --json` does not read CLAUDE.md, and the guard hook does not require it.

**Risk: Template and deployed skill/agent copies drifting.**
Mitigation: The byte-identity requirement is enforced by existing static-file tests (see Test Strategy). The executor must update both copies in the same commit and must verify byte identity before committing.

**Risk: `metta refresh` call in skill fails if `spec/project.md` was not written by the agent (e.g., agent errored).**
Mitigation: The skill orchestrator already controls sequencing. If the discovery agent fails or returns early, the skill should not proceed to step 3a. No defensive shell handling is needed beyond normal skill orchestration — a failed agent will surface to the user before the refresh step is reached.

**Risk: Discovery agent's role description still references CLAUDE.md generation in prose after the `git add` line is fixed.**
Mitigation: The "## Your Role" description is updated in the same edit to remove the CLAUDE.md reference. Both the template and deployed copies must be updated identically.

---

## Test Strategy

### REQ-1: install produces no CLAUDE.md

**Modify: `tests/cli.test.ts` — install describe block**

Add a new assertion to the existing "fresh install" test case (or scenario 1.1 if one is added):

```typescript
expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false)
```

The research confirms no existing install test asserts `CLAUDE.md` exists today, so no test needs to be removed — only the positive assertion needs to be added. Scenario 1.2 (JSON output) is satisfied implicitly since the JSON object never contained `claude_md`; add a snapshot or key-check assertion to make it explicit and regression-proof.

### REQ-2: init skill produces CLAUDE.md after discovery

The `/metta:init` skill is a Markdown prompt file, not TypeScript — it cannot be unit-tested via Vitest directly. Test coverage for REQ-2 scenarios 2.1-2.4 is addressed at two levels:

**Static content test (new or extended in `tests/skill-files.test.ts` or equivalent):**
Assert that `src/templates/skills/metta-init/SKILL.md` contains the string `metta refresh`. This is a low-cost structural guard that will catch accidental removal of the refresh step.

**Unit test for the refresh path (`tests/refresh.test.ts` or new `tests/init-flow.test.ts`):**
Add a test that writes a populated `spec/project.md` to a temp directory, calls `runRefresh(tmpDir, false)`, then asserts `CLAUDE.md` exists and is non-empty. This covers scenario 3.2 (init-flow test asserting CLAUDE.md creation) and provides coverage for the post-discovery refresh behavior.

### REQ-3: install test block has no CLAUDE.md assertion

Satisfied by the REQ-1 work above. After adding the negative assertion (`CLAUDE.md` must NOT exist), verify via grep that no `expect` call in the install describe block references `CLAUDE.md` positively.

### Byte-identity tests for skill and agent files

If `tests/template-files.test.ts` (or equivalent) already checks that `src/templates/skills/metta-init/SKILL.md` and `.claude/skills/metta-init/SKILL.md` are byte-identical, that test will automatically catch drift after this change. If no such test exists for `metta-discovery.md`, add one covering both template and deployed copies of the discovery agent.
