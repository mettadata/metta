# Tasks: metta-fix-issues-cli-command-m

## Batch 1 — Foundation (parallel)

### Task 1.1 — Extend IssuesStore with archive and remove methods [x]

**Files:**
- `src/issues/issues-store.ts` (modify)
- `tests/issues-store.test.ts` (create)

**Action:**
Append two new async methods to the `IssuesStore` class after the existing `exists` method (line 104). `archive(slug)` must call `this.exists(slug)` first and throw `new Error(\`Issue '\${slug}' not found\`)` if false; then read content via `this.state.readRaw`, call `mkdir(join(this.specDir, 'issues', 'resolved'), { recursive: true })`, and write to `this.state.writeRaw(join('issues', 'resolved', \`\${slug}.md\`), content)` — the `writeRaw` overwrite satisfies idempotency. `remove(slug)` delegates to `this.state.delete(join('issues', \`\${slug}.md\`))`, which throws `ENOENT` on a missing file. Create `tests/issues-store.test.ts` with five test cases (TC-IS-01 through TC-IS-05) covering all four spec scenarios plus the implied "remove throws when absent" case, each using a temp directory as `specDir`.

**Verify:**
- `npx vitest run tests/issues-store.test.ts`
- Scenarios covered: issues-store-archival/archive-moves-content, issues-store-archival/archive-on-missing-slug-throws, issues-store-archival/archive-is-idempotent, issues-store-archival/remove-deletes-open-issue-file

**Done:** All five `IssuesStore` unit tests pass and both `archive` and `remove` are exported on the class.

---

### Task 1.2 — Create metta-fix-issues skill template and deployed copy

**Files:**
- `src/templates/skills/metta-fix-issues/SKILL.md` (create)
- `.claude/skills/metta-fix-issues/SKILL.md` (create, byte-identical)

**Action:**
Copy `.claude/skills/metta-fix-gap/SKILL.md` and apply all token substitutions from research §4: `metta:fix-gap` → `metta:fix-issues` in frontmatter, `fix-gap` command → `fix-issue`, skill name references `fix-gap` → `fix-issues`, `gap`/`gaps` → `issue`/`issues`, `metta gaps list` → `metta issues list`, `metta gaps show` → `metta issue show`, `--remove-gap` → `--remove-issue`, commit message prefix `fix(gaps): remove resolved gap` → `fix(issues): remove resolved issue`, archive path `spec/archive/` → `spec/issues/resolved/`, interactive hint `/metta-fix-gap` → `/metta-fix-issues`, and propose description pattern `"fix gap: <slug> — <summary>"` → `"fix issue: <slug> — <title>"`. The Remove step (step 10) must call `metta fix-issue --remove-issue <slug>`. Write the resulting file byte-identical to both paths; all four CLI invocation modes (`fix-issue <slug>`, `fix-issue --all`, `fix-issue --remove-issue`, no-argument `/metta-fix-issues`) must appear in the body.

**Verify:**
- TC-SKILL-01: YAML frontmatter of `src/templates/skills/metta-fix-issues/SKILL.md` contains exactly `name: metta:fix-issues`
- TC-SKILL-02: byte-by-byte diff of template vs deployed copy returns no differences — `diff src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md`
- TC-SKILL-03: `grep -c "fix-issue" src/templates/skills/metta-fix-issues/SKILL.md` finds references to all four modes

**Done:** Both skill files exist, are byte-identical, and contain all four CLI mode references.

---

## Batch 2 — CLI command implementation (depends on 1.1)

### Task 2.1 — Create src/cli/commands/fix-issue.ts

**Files:**
- `src/cli/commands/fix-issue.ts` (create)

**Action:**
Create the file implementing the four-branch structure documented in design §Components. Declare a module-local `IssueSeverity = 'critical' | 'major' | 'minor'` type and `severityWeight` map `{ critical: 0, major: 1, minor: 2 }` — these must not reference `fix-gap.ts` types. Export `sortBySeverityForIssues<T extends { severity: IssueSeverity }>(issues: T[]): T[]` and `registerFixIssueCommand(program: Command): void`. The action handler evaluates branches in priority order: (1) `--remove-issue <slug>`: call `issuesStore.exists`, on false emit error and exit 4, on true call `issuesStore.archive(slug)` then `issuesStore.remove(slug)`, then run `git add spec/issues spec/issues/resolved` and `git commit -m "fix(issues): remove resolved issue <slug>"` in a bare `try/catch`, emit `{ removed: slug }` / `Removed issue: <slug>` and exit 0; (2) single `[issue-slug]`: call `exists`, exit 4 on not-found, call `issuesStore.show(slug)` and print `title`, `severity`, `status`, `description`, optional `captured` and `context`, plus delegate hint `metta execute --skill fix-issues --target <slug>`; (3) `--all`: call `issuesStore.list()` (no raw-file re-read — `list()` returns `severity` directly per research §1), sort with `sortBySeverityForIssues`, filter by `options.severity` when provided, format each line as `  [SEVERITY ] [STATUS] <slug padded to 30>  <title>` hardcoding `'logged'` for status per the design risks note; (4) no args: print usage block referencing `/metta-fix-issues`. All branches honour `program.opts().json`. Exit code 4 matches `fix-gap.ts` exactly. Import `createCliContext` and `outputJson` from `../helpers.js`, `execFile`+`promisify` from `node:child_process`, `join` from `node:path`, `IssuesStore` from `../../issues/issues-store.js`, and `Command` from `commander`.

**Verify:**
- `npx tsc --noEmit` passes on the new file
- Manual: `node dist/cli/index.js fix-issue` prints usage with `/metta-fix-issues` reference
- TC-CLI-01 through TC-CLI-06 in the design test strategy are covered by the implementation contract

**Done:** `fix-issue.ts` compiles without errors and exports `registerFixIssueCommand`.

---

## Batch 3 — CLI registration (depends on 2.1)

### Task 3.1 — Register fix-issue command in src/cli/index.ts

**Files:**
- `src/cli/index.ts` (modify)

**Action:**
Add one import line after the existing `registerFixGapCommand` import (line 34): `import { registerFixIssueCommand } from './commands/fix-issue.js'`. Add one registration call immediately after `registerFixGapCommand(program)` (line 79): `registerFixIssueCommand(program)`. Placing `fix-issue` adjacent to `fix-gap` keeps related commands visually grouped in both source and `--help` output, as stated in design §Registration.

**Verify:**
- `npx tsc --noEmit` passes
- `node dist/cli/index.js --help` stdout includes `fix-issue` with a short description
- TC-CLI-07: `metta --help` includes `fix-issue`
- TC-CLI-08 (static): `src/cli/index.ts` contains `registerFixIssueCommand(program)` and the import resolves to `./commands/fix-issue.js`

**Done:** `metta --help` lists `fix-issue` and `src/cli/index.ts` contains both the import and registration call.

---

## Batch 4 — Test coverage (depends on 2.1, 1.2, 3.1)

### Task 4.1 — Add CLI and skill tests to tests/cli.test.ts

**Files:**
- `tests/cli.test.ts` (modify)

**Action:**
Append eight CLI test cases (TC-CLI-01 through TC-CLI-08) and three skill template test cases (TC-SKILL-01 through TC-SKILL-03) to the existing `tests/cli.test.ts` file. CLI tests use the same helper patterns already in the file (seed a temp specDir for store-backed cases). TC-CLI-06 (--remove-issue) must assert: `spec/issues/resolved/stale-issue.md` exists, `spec/issues/stale-issue.md` is absent, and `git log` contains a commit with message `fix(issues): remove resolved issue stale-issue`. TC-CLI-04 and TC-CLI-05 seed three issues with out-of-order severities (`minor`, `critical`, `major`) and assert sort order and filter behaviour. Skill template tests read the files from the repo tree (not a temp dir) and assert frontmatter, byte-identity, and four-mode presence.

**Verify:**
- `npx vitest run tests/cli.test.ts` — all 11 new cases pass
- Scenario IDs: fix-issue-cli-command/{no-args, single-slug, single-slug-not-found, all-sorted, all-severity-filter, remove-archives-commits}, cli-registration/{help-output, index-registration}, skill-template/{correct-frontmatter, byte-identical, four-modes}

**Done:** All 11 appended test cases pass with zero failures.

---

## Batch 5 — Full verification (depends on all)

### Task 5.1 — Build, full test suite, and smoke test

**Files:** none (verification only)

**Action:**
Run `npm run build` to confirm template skill files are copied to `dist/` and the TypeScript compilation succeeds end-to-end. Run `npm test` (full Vitest suite) to confirm no regressions. Run three smoke commands against a temporary metta project directory (created via `metta init` in a temp path): `metta fix-issue` (no args — verify usage text), `metta fix-issue --all` (verify tabular output or "no issues" message), and `metta fix-issue --remove-issue <any-existing-slug>` if an open issue exists, otherwise skip the third command and confirm exit 4 on a nonexistent slug.

**Verify:**
- `npm run build` exits 0
- `npm test` exits 0 with no failing tests
- `metta fix-issue` prints `Usage: metta fix-issue` and references `/metta-fix-issues`
- `metta --help` lists `fix-issue`
- All 15 spec scenarios have corresponding passing tests (see coverage table below)

**Done:** `npm run build` and `npm test` both exit 0; smoke commands behave per spec on a live project.

---

## Scenario Coverage

| Scenario ID | Requirement | Covered By |
|-------------|------------|------------|
| fix-issue-cli-command/no-args-prints-usage | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-01) |
| fix-issue-cli-command/single-slug-prints-details-and-delegate-hint | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-02) |
| fix-issue-cli-command/single-slug-not-found-exits-non-zero | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-03) |
| fix-issue-cli-command/all-lists-issues-sorted-severity-first | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-04) |
| fix-issue-cli-command/all-severity-filters-to-matching-tier | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-05) |
| fix-issue-cli-command/remove-issue-archives-and-commits | fix-issue-cli-command | 2.1, 4.1 (TC-CLI-06) |
| issues-store-archival/archive-moves-content-to-resolved-directory | issues-store-archival | 1.1 (TC-IS-01) |
| issues-store-archival/archive-on-missing-slug-throws | issues-store-archival | 1.1 (TC-IS-02) |
| issues-store-archival/archive-is-idempotent-when-resolved-copy-already-exists | issues-store-archival | 1.1 (TC-IS-03) |
| issues-store-archival/remove-deletes-the-open-issue-file | issues-store-archival | 1.1 (TC-IS-04) |
| skill-template/template-file-exists-with-correct-frontmatter-name | skill-template | 1.2, 4.1 (TC-SKILL-01) |
| skill-template/deployed-skill-is-byte-identical-to-template | skill-template | 1.2, 4.1 (TC-SKILL-02) |
| skill-template/skill-body-references-all-four-cli-invocation-modes | skill-template | 1.2, 4.1 (TC-SKILL-03) |
| cli-registration/command-appears-in-help-output | cli-registration | 3.1, 4.1 (TC-CLI-07) |
| cli-registration/registerFixIssueCommand-is-called-in-index-ts | cli-registration | 3.1, 4.1 (TC-CLI-08) |
