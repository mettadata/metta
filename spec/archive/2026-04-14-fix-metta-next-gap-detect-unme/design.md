# Design: fix-metta-next-gap-detect-unme

## Approach
Add a post-finalize branch check in `src/cli/commands/next.ts`. When `listChanges()` returns empty, inspect the current git branch and its ahead-count against the configured base branch before falling through to the "propose" response. On match, emit a `ship` action; otherwise fall through unchanged. Update both copies of the `/metta-next` skill to handle `next: "ship"` the same way they handle `next: "finalize"`.

## Components

### `src/cli/commands/next.ts` (modified)
- Add a private helper `async function detectShipCandidate(root: string, baseBranch: string): Promise<{change: string, branch: string} | null>`:
  - `execFile('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root })` — catch, return `null`
  - If branch does not match `/^metta\/(.+)$/`, return `null`
  - `execFile('git', ['rev-list', '--count', `${baseBranch}..HEAD`], { cwd: root })` — catch, return `null`
  - If count === 0, return `null`
  - Return `{change: match[1], branch: <branch>}`
- In the `changes.length === 0` branch (`next.ts:17`), load config via existing `ctx.configLoader.load()`, compute base branch (`config.git?.pr_base ?? 'main'`), call the helper. If non-null, emit the ship response; else preserve existing propose response.

### `src/cli/commands/next.ts` response shape (new)
```json
{
  "next": "ship",
  "action": "ship",
  "command": "metta ship --branch metta/<change>",
  "change": "<change>",
  "branch": "metta/<change>"
}
```
Human-mode output:
```
Ready to ship: <change>
Next: metta ship --branch metta/<change>
```

### `.claude/skills/metta-next/SKILL.md` and `src/templates/skills/metta-next/SKILL.md`
Add one bullet to the Rules section:
- `If `metta next` says "ship", run `/metta-ship` (or the returned command) to merge the branch to main`

Both files must be updated in the same commit to stay byte-identical.

## Data Model
No state or schema changes. `ctx.configLoader.load()` returns the existing config shape; `config.git.pr_base` already exists and is used by `ship.ts`.

## API Design
- `metta next` — adds possible `next: "ship"` value. Consumers checking against a whitelist must add it.
- `metta next --change <name>` — unaffected; the branch check only runs when `listChanges()` is empty.
- No new CLI flags.

## Dependencies
Internal only: `node:child_process` (`execFile`), `node:util` (`promisify`). Both already imported by neighbouring commands. No new packages.

## Risks & Mitigations
- **Risk**: `git symbolic-ref` hangs on a broken repo. Mitigation: wrap in try/catch with no retry; fallback to propose.
- **Risk**: User is on a `metta/<name>` branch whose change is still active (under `spec/changes/`). Not a concern — the branch check only runs after the `changes.length === 0` guard, so this path is unreachable when there are active changes.
- **Risk**: Stacked branches — user finishes change A on branch `metta/a`, then branches off to `metta/b` without shipping A. `next` would report `b` as ship candidate even though A is unshipped. Accepted: `next` reports one step at a time; user ships A first, switches back, then `next` reports nothing to ship. Not a correctness bug.
- **Risk**: `config.git` is unset. Mitigation: `?? 'main'` default matches `ship.ts`. Verified.

## Test Strategy
Modify `tests/cli.test.ts` to add a `describe('metta next post-finalize', ...)` block with:

1. **`returns ship when on metta/* branch ahead of main`**
   - setup: `git init`, commit, create `main`, `git checkout -b metta/example`, commit a file, run `metta next --json`
   - assert: `next === "ship"`, `change === "example"`, `branch === "metta/example"`, command contains `--branch metta/example`

2. **`returns propose when on metta/* branch with zero commits ahead`**
   - setup: `git init`, commit, create `main`, `git checkout -b metta/clean`, no new commits, run `metta next --json`
   - assert: `next === "propose"`

3. **`returns propose when on main`**
   - setup: `git init`, commit on main, run `metta next --json`
   - assert: `next === "propose"`

4. **`returns propose when main branch is missing`**
   - setup: `git init`, `git checkout -b metta/orphan`, commit, run `metta next --json`
   - assert: `next === "propose"` (no throw)

5. **static skill-file test**: both `src/templates/skills/metta-next/SKILL.md` and `.claude/skills/metta-next/SKILL.md` contain a rule referencing `ship` in the same way they reference `finalize`.

No changes to unit tests for `workflow-engine` — that module's behavior is unaffected.
