# Tasks: fix-issue-metta-install-should

## Batch 1 — Source edits (independent, parallel-safe)

### Task 1.1 — Remove `runRefresh` from `install.ts` and strip `CLAUDE.md` from git add [x]

**Files**
- `src/cli/commands/install.ts`

**Action**
Delete lines 177-183 (the `// Generate CLAUDE.md using the same code as metta refresh` comment plus the try/catch block that imports and calls `runRefresh`). On line 188 (now renumbered after deletion), change the `git add` arguments from `['.metta/', 'spec/', 'CLAUDE.md']` to `['.metta/', 'spec/']`.

**Verify**
- `grep -n 'runRefresh\|CLAUDE.md' src/cli/commands/install.ts` returns no matches
- Scenarios 1.1, 1.2, 1.3

**Done**
`install.ts` no longer references `runRefresh` or `CLAUDE.md` anywhere.

---

### Task 1.2 [x] — Add post-discovery refresh step to `/metta:init` skill (both copies)

**Files**
- `src/templates/skills/metta-init/SKILL.md`
- `.claude/skills/metta-init/SKILL.md`

**Action**
Insert a new step 3a between step 3 (spawn metta-discovery agent) and step 4 (report to user) in both files. The new step instructs the orchestrator to run `metta refresh` via Bash after the discovery agent returns, then stage and commit `CLAUDE.md` in a separate commit with message `chore: generate CLAUDE.md from discovery`. Both files must be byte-identical after the edit.

**New step to insert (before the existing "4. Report to user" line):**
```
4. After the discovery agent returns, run in Bash:
   ```
   metta refresh
   ```
   Then stage and commit CLAUDE.md separately:
   ```
   git add CLAUDE.md && git commit -m "chore: generate CLAUDE.md from discovery"
   ```

5. Report to user what was generated
```
Renumber the old step 4 to step 5.

**Verify**
- `diff src/templates/skills/metta-init/SKILL.md .claude/skills/metta-init/SKILL.md` produces no output
- `grep 'metta refresh' src/templates/skills/metta-init/SKILL.md` matches
- Scenarios 2.1, 2.3

**Done**
Both skill files are byte-identical and contain the `metta refresh` post-step.

---

### Task 1.3 [x] — Remove `CLAUDE.md` from discovery agent commit and update role description (both copies)

**Files**
- `src/templates/agents/metta-discovery.md`
- `.claude/agents/metta-discovery.md`

**Action**
On line 28 of each file, remove `CLAUDE.md` from the `git add` arguments so the agent's commit becomes `git add spec/project.md .metta/config.yaml && git commit -m "docs: generate project constitution"`. Also update the "## Your Role" description on line 12 to replace "and AI context file (CLAUDE.md)" with "and project config (.metta/config.yaml)". Both files must be byte-identical after the edit.

**Verify**
- `diff src/templates/agents/metta-discovery.md .claude/agents/metta-discovery.md` produces no output
- `grep 'CLAUDE.md' src/templates/agents/metta-discovery.md` returns no matches
- Scenarios 2.3, 2.4

**Done**
Both agent files are byte-identical and contain no reference to `CLAUDE.md` in the git add or role description.

---

## Batch 2 — Test updates (depends on Batch 1)

### Task 2.1 — Add negative CLAUDE.md assertion to install test block

**Files**
- `tests/cli.test.ts`

**Action**
In the `describe('metta install', ...)` block, extend the "creates git repo with --git-init flag" test (around line 53) to assert `existsSync(join(tempDir, 'CLAUDE.md'))` is `false`. Add a second assertion to the `--json` output test (around line 65) that `data` does not have a `claude_md` key — e.g. `expect(data).not.toHaveProperty('claude_md')`.

**Verify**
- `grep -n 'CLAUDE.md' tests/cli.test.ts` shows only negative assertions within the install block
- Scenarios 1.1, 1.2, 3.1

**Done**
Install test block contains one `toBe(false)` assertion for CLAUDE.md existence and one `not.toHaveProperty('claude_md')` assertion on the JSON output.

---

### Task 2.2 — Add static skill-content test and init-flow refresh test

**Files**
- `tests/cli.test.ts`

**Action**
In the existing `describe('metta-init skill template', ...)` block (line 181), add one assertion that `src/templates/skills/metta-init/SKILL.md` contains the string `metta refresh` and one assertion that the deployed copy at `.claude/skills/metta-init/SKILL.md` is byte-identical to the template. Then add a new `describe('init flow — CLAUDE.md generation', ...)` block containing a test that writes a minimal populated `spec/project.md` to a temp directory, calls `runRefresh(tmpDir, false)`, and asserts that `CLAUDE.md` exists and is non-empty.

**Verify**
- `npx vitest run tests/cli.test.ts` passes with the new assertions green
- Scenarios 3.2, 2.1 (structural guard)

**Done**
Test suite contains a static content guard on the skill and a unit-level integration test exercising the post-discovery refresh path.

---

## Batch 3 — Build, test, smoke (depends on Batches 1 and 2)

### Task 3.1 — Full build, test suite, and smoke run

**Files**
- None modified; verification only.

**Action**
Run `npm run build` to confirm TypeScript compiles without errors after the `runRefresh` removal. Run `npm test` (or `npx vitest run`) to confirm all tests pass including the new assertions. Then run a smoke test: create a temp directory, `git init` it, run `node dist/cli.js install --git-init`, confirm `CLAUDE.md` does not exist, and confirm the commit log shows `chore: initialize metta` without `CLAUDE.md` in the diff (`git show --name-only HEAD`).

**Verify**
- `npm run build` exits 0
- `npm test` exits 0, no regressions
- `CLAUDE.md` absent from tmp dir after smoke install
- `git show --name-only HEAD` in tmp dir lists no `CLAUDE.md`
- Scenarios 1.1, 1.2, 1.3, 2.4, 3.1, 3.2

**Done**
Build green, all tests pass, smoke confirms no CLAUDE.md on fresh install.

---

## Scenario Coverage

| Scenario | Description | Task(s) |
|----------|-------------|---------|
| 1.1 | Fresh install produces no CLAUDE.md | 1.1, 2.1, 3.1 |
| 1.2 | `--json` output contains no `claude_md` key | 1.1, 2.1, 3.1 |
| 1.3 | Re-running install does not overwrite existing CLAUDE.md | 1.1, 3.1 |
| 2.1 | CLAUDE.md exists after `/metta:init` completes | 1.2, 2.2, 3.1 |
| 2.2 | CLAUDE.md reflects project.md content after init | 1.2, 2.2 |
| 2.3 | install + init sequence: CLAUDE.md only after init commit | 1.2, 1.3, 3.1 |
| 2.4 | `metta init` CLI emits no CLAUDE.md side-effect | 1.3, 3.1 |
| 3.1 | Install test block has no positive CLAUDE.md assertion | 2.1, 3.1 |
| 3.2 | Init-flow test asserts CLAUDE.md creation after refresh | 2.2, 3.1 |
