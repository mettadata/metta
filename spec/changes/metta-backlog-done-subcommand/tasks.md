# Tasks: metta-backlog-done-subcommand

**Change:** metta-backlog-done-subcommand
**Date:** 2026-04-14
**Status:** Ready

---

## Batch 1 — Store hardening + skill update (parallel-safe)

### Task 1.1 — Harden BacklogStore: add SLUG_RE, assertSafeSlug, archive(), and guards [x]

**Files:**
- `src/backlog/backlog-store.ts` (modify)
- `tests/backlog-store.test.ts` (modify)

**Action:**

1. Audit `tests/backlog-store.test.ts` for any fixture that passes a non-slug string directly to `show()`, `exists()`, or `remove()`. The existing test `'removes a backlog item'` uses `'to-remove'` (valid slug) and `'to-remove'` — safe. No existing test fixture uses hostile inputs; no existing tests will break.

2. In `src/backlog/backlog-store.ts`, add immediately after the `slugify` function:
   ```
   const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

   function assertSafeSlug(slug: string): void {
     if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
       throw new Error(`Invalid backlog slug '${slug}' — must match ${SLUG_RE}`)
     }
   }
   ```
   Pattern is identical to `src/issues/issues-store.ts` lines 55-60 with `backlog` replacing `issue`.

3. Add `assertSafeSlug(slug)` as the first statement in `show()`, `exists()`, and `remove()`.

4. Add new method `archive(slug: string, changeName?: string): Promise<void>` after `remove()`:
   - Call `assertSafeSlug(slug)`.
   - If `!(await this.state.exists(join('backlog', `${slug}.md`)))`, throw `Error: Backlog item '${slug}' not found`.
   - `let content = await this.state.readRaw(join('backlog', `${slug}.md`))`.
   - If `changeName` is defined: call `assertSafeSlug(changeName)`; then `content = content.trimEnd() + '\n**Shipped-in**: ' + changeName + '\n'`.
   - `await mkdir(join(this.specDir, 'backlog', 'done'), { recursive: true })`.
   - `await this.state.writeRaw(join('backlog', 'done', `${slug}.md`), content)`.

5. In `tests/backlog-store.test.ts`, add a `describe('archive()')` block and a `describe('assertSafeSlug guards')` block covering the 8 unit scenarios listed in the design test strategy table:
   - Scenario 2.1: `archive()` creates `spec/backlog/done/` when absent and writes file.
   - Scenario 2.2: `archive('some-item', 'my-change')` appends `**Shipped-in**: my-change`.
   - Scenario 2.3: `archive('ghost-item')` throws matching `/Backlog item 'ghost-item' not found/`; no file written.
   - Scenario 2.4: `archive('../../../etc/passwd')` throws matching `/Invalid backlog slug/`; no FS access.
   - Scenario 2.5: `remove('../escape')` throws before any delete.
   - Scenario 4.1: `show('../../secret')` throws matching `/Invalid backlog slug '\.\.\/\.\.\/secret'/`.
   - Scenario 4.2: `exists('../etc/hosts')` throws matching `/Invalid backlog slug/`.
   - Scenario 4.3: `archive('valid-item', '../../hostile')` throws matching `/Invalid backlog slug '\.\.\/\.\.\/hostile'/`; no write.
   - Bonus: `archive('item;rm -rf', undefined)` throws matching `/Invalid backlog slug/`.

**Verify:**
- `npx tsx --tsconfig tsconfig.json` type-checks `src/backlog/backlog-store.ts` without error.
- `npx vitest run tests/backlog-store.test.ts` — all tests pass, including 9 new ones.
- Confirm `assertSafeSlug` is not exported (module-private).

**Done:** All `tests/backlog-store.test.ts` pass. `archive()` is present in `BacklogStore`. Guards are first statement in `show()`, `exists()`, `remove()`, `archive()`.

---

### Task 1.2 — Extend /metta-backlog skill with `done` branch (byte-identical pair) [x]

**Files:**
- `src/templates/skills/metta-backlog/SKILL.md` (modify)
- `.claude/skills/metta-backlog/SKILL.md` (modify — must be byte-identical to template after edit)

**Action:**

1. In `src/templates/skills/metta-backlog/SKILL.md`, make two edits:

   a. Step 1 picker line: change `list | show | add | promote` to `list | show | add | promote | done`.

   b. In Step 2's dispatch table, add a new `done` branch after `promote`:
      ```
      - **done** → run `metta backlog list --json`, parse `.backlog[].slug` from the output to build the list of available slugs. Present the slugs via `AskUserQuestion`. Then ask, via `AskUserQuestion`, for an optional change name to record as `--change <name>` (free-form; if the user skips or leaves blank, omit the flag). Run `metta backlog done <slug>` or `metta backlog done <slug> --change <changeName>` as appropriate. Echo the archived path printed by the CLI back to the user.
      ```

2. Copy the edited file byte-for-byte to `.claude/skills/metta-backlog/SKILL.md`. The easiest safe approach: write the same content to both files. Verify with a checksum comparison.

**Verify:**
- `diff src/templates/skills/metta-backlog/SKILL.md .claude/skills/metta-backlog/SKILL.md` produces no output.
- Both files contain `done`, `metta backlog done`, and `--change`.
- Picker line in both files reads exactly: `list`, `show`, `add`, `promote`, `done`.

**Done:** Both skill files are byte-identical. Both contain the `done` branch text with the correct command forms.

---

## Batch 2 — CLI subcommand (depends on 1.1)

### Task 2.1 — Add `backlog done <slug> [--change <name>]` subcommand [x]

**Files:**
- `src/cli/commands/backlog.ts` (modify)

**Dependencies:** Task 1.1 must be complete (`BacklogStore.archive()` and guards must exist).

**Action:**

1. Add to the top of `src/cli/commands/backlog.ts`:
   ```typescript
   import { execFile } from 'node:child_process'
   import { promisify } from 'node:util'
   const execAsync = promisify(execFile)
   const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
   ```

2. Register the new subcommand after `promote`, inside `registerBacklogCommand`:
   ```typescript
   backlog
     .command('done')
     .argument('<slug>', 'Item slug')
     .option('--change <name>', 'Change name to stamp as Shipped-in metadata')
     .description('Archive a shipped backlog item')
     .action(async (slug, options) => {
       const json = program.opts().json
       const ctx = createCliContext()
       const changeName: string | undefined = options.change

       // Guard: validate changeName against SLUG_RE before any store call
       if (changeName !== undefined && !SLUG_RE.test(changeName)) {
         console.error(`Invalid change name '${changeName}' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)`)
         process.exit(4)
       }

       // Check existence
       const found = await ctx.backlogStore.exists(slug)
       if (!found) {
         console.error(`Backlog item '${slug}' not found`)
         process.exit(4)
       }

       // Archive then remove
       await ctx.backlogStore.archive(slug, changeName)
       await ctx.backlogStore.remove(slug)

       // Git commit (graceful-skip, matching fix-issue.ts pattern)
       let committed = false
       let commitSha: string | undefined
       try {
         await execAsync('git', ['add', join('spec', 'backlog'), join('spec', 'backlog', 'done')], { cwd: ctx.projectRoot })
         await execAsync('git', ['commit', '-m', `chore: archive shipped backlog item ${slug}`], { cwd: ctx.projectRoot })
         const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: ctx.projectRoot })
         committed = true
         commitSha = stdout.trim()
       } catch {
         // git unavailable or nothing to commit — swallow silently
       }

       // Output
       if (json) {
         outputJson({ archived: slug, shipped_in: changeName ?? null, committed, commit_sha: commitSha })
       } else {
         console.log(`Archived backlog item: ${slug}`)
       }
     })
   ```

**Verify:**
- `npx tsx --tsconfig tsconfig.json` type-checks `src/cli/commands/backlog.ts` without error.
- `npx tsx src/cli/index.ts backlog done --help` shows the subcommand and `--change` option.
- Handler validates `changeName` before calling the store (guard in CLI, defense-in-depth in store).

**Done:** `metta backlog done --help` prints usage. Subcommand is registered after `promote`.

---

## Batch 3 — CLI tests (depends on 2.1 and 1.2)

### Task 3.1 — Add CLI integration tests and skill static-content assertions [x]

**Files:**
- `tests/cli.test.ts` (modify — append new describe blocks)

**Dependencies:** Tasks 2.1 (subcommand wired) and 1.2 (skill files updated) must be complete.

**Action:**

Add two new `describe` blocks to `tests/cli.test.ts`:

**Block A — `describe('metta backlog done')`** covering these scenarios:

- **Scenario 1.1 (happy path, no --change):** Create a tmp project with `spec/backlog/<slug>.md`. Run `metta backlog done <slug>`. Assert exit 0, stdout contains `Archived backlog item: <slug>`, `spec/backlog/done/<slug>.md` exists, `spec/backlog/<slug>.md` is gone.

- **Scenario 1.2 (--change stamps metadata):** Same setup. Run `metta backlog done <slug> --change my-change`. Assert exit 0, `spec/backlog/done/<slug>.md` contains `**Shipped-in**: my-change`.

- **Scenario 1.3 (unknown slug exits 4):** Run `metta backlog done nonexistent-item`. Assert exit 4, stderr contains `not found`, no file written under `spec/backlog/done/`.

- **Scenario 1.4 (--json output):** Setup item. Run `metta backlog done my-item --json`. Assert exit 0, stdout is valid JSON with `"archived": "my-item"`, `"shipped_in"` key present.

- **Scenario 1.5 (git unavailable, still succeeds):** Setup item. Override PATH to exclude git. Run `metta backlog done <slug>`. Assert exit 0, archived file exists, original deleted.

- **Hostile changeName (exit 4):** Run `metta backlog done valid-item --change ../../hostile`. Assert exit 4, stderr contains `Invalid change name`.

- **Git commit message assertion:** Happy-path run in a real git repo (use `git init` + initial commit in beforeEach). Capture `git log --oneline -1` after run. Assert message matches `chore: archive shipped backlog item <slug>`.

**Block B — `describe('metta-backlog skill byte-identity')`** covering:

- **Scenario 3.3:** Read both `src/templates/skills/metta-backlog/SKILL.md` and `.claude/skills/metta-backlog/SKILL.md` via `readFile`. Assert they are byte-identical (`expect(a).toBe(b)`). Assert both contain `metta backlog done` and `--change`.

Note: The test suite uses `npx tsx <CLI_PATH>` to invoke the CLI. For git commit assertions, initialize a real git repo in the temp dir with `git init && git config user.email && git config user.name && git commit --allow-empty -m "init"` before the test run.

**Verify:**
- `npx vitest run tests/cli.test.ts` — all tests pass including the new 9 cases.
- No test reaches into `src/` directly for backlog logic; all assertions go through the CLI binary or file reads.

**Done:** All new CLI tests pass. Skill byte-identity test passes.

---

## Batch 4 — Full build, test suite, and smoke (depends on all)

### Task 4.1 — Build, full test suite, and end-to-end smoke

**Files:** None modified.

**Dependencies:** Tasks 1.1, 1.2, 2.1, 3.1 complete.

**Action:**

1. Full TypeScript build: `npm run build`. Confirm zero errors and that `dist/templates/skills/metta-backlog/SKILL.md` is present (template copy step).

2. Full test suite: `npx vitest run`. All tests must pass. Record counts: total, passed, failed.

3. End-to-end smoke on a tmp project:
   ```bash
   TMPDIR=$(mktemp -d)
   cd $TMPDIR
   git init
   git config user.email "smoke@test.local"
   git config user.name "Smoke"
   npx tsx <abs-path-to>/src/cli/index.ts install --git-init 2>/dev/null || true
   npx tsx <abs-path-to>/src/cli/index.ts backlog add "smoke test item" --priority low
   SLUG=$(npx tsx <abs-path-to>/src/cli/index.ts backlog list --json | npx -y jq -r '.backlog[0].slug')
   npx tsx <abs-path-to>/src/cli/index.ts backlog done "$SLUG" --change metta-backlog-done-subcommand
   ```
   Assert:
   - Exit 0 from `done` invocation.
   - `spec/backlog/done/$SLUG.md` exists and contains `**Shipped-in**: metta-backlog-done-subcommand`.
   - `spec/backlog/$SLUG.md` does not exist.
   - `git log --oneline -1` shows `chore: archive shipped backlog item $SLUG`.

4. Confirm `dist/templates/skills/metta-backlog/SKILL.md` is byte-identical to `.claude/skills/metta-backlog/SKILL.md` (the build copies from `src/templates/`, not from `.claude/`; both should match the same content post-edit).

**Verify:**
- `npm run build` exits 0.
- `npx vitest run` exits 0 with 0 failures.
- Smoke script exits 0 for each command; all file assertions hold.

**Done:** Build clean. All tests green. Smoke confirms the full archive-remove-commit flow end-to-end.

---

## Scenario Coverage Table

Maps all 13 spec scenarios to the task that implements them.

| Scenario | Description | Covered By |
|----------|-------------|------------|
| 1.1 | Archive without `--change` — file moved, commit, exit 0 | Task 2.1 (impl), Task 3.1 (test) |
| 1.2 | Archive with `--change` stamps `**Shipped-in**` | Task 2.1 (impl), Task 3.1 (test) |
| 1.3 | Unknown slug exits 4, nothing written to `done/` | Task 2.1 (impl), Task 3.1 (test) |
| 1.4 | `--json` output has `"archived"` key | Task 2.1 (impl), Task 3.1 (test) |
| 1.5 | Git unavailable — command still succeeds | Task 2.1 (impl), Task 3.1 (test) |
| 2.1 | `archive()` creates `done/` when absent | Task 1.1 (impl + unit test) |
| 2.2 | `archive()` with `changeName` stamps `Shipped-in` | Task 1.1 (impl + unit test) |
| 2.3 | `archive()` throws for missing item | Task 1.1 (impl + unit test) |
| 2.4 | `archive()` rejects path-traversal slug | Task 1.1 (impl + unit test) |
| 2.5 | `remove()` rejects path-traversal slug | Task 1.1 (impl + unit test) |
| 3.1 | Skill `done` branch with change name | Task 1.2 (skill content), Task 3.1 (static assertion) |
| 3.2 | Skill `done` branch — change name skipped | Task 1.2 (skill content), Task 3.1 (static assertion) |
| 3.3 | Skill files are byte-identical | Task 1.2 (impl), Task 3.1 (test) |
| 4.1 | `show()` rejects hostile slug | Task 1.1 (impl + unit test) |
| 4.2 | `exists()` rejects hostile slug | Task 1.1 (impl + unit test) |
| 4.3 | `archive()` rejects hostile `changeName` | Task 1.1 (impl + unit test) |
| CLI guard | `--change ../../hostile` exits 4 | Task 2.1 (impl), Task 3.1 (test) |
| Git message | Commit matches `chore: archive shipped backlog item <slug>` | Task 2.1 (impl), Task 3.1 (test) |
