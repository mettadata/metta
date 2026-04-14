# Research: fix-metta-next-gap-detect-unme

## Decision: branch detection via git CLI, base from config

### Approaches Considered

1. **Shell out to `git` from `next.ts`** (selected) — Match the pattern used elsewhere in the codebase (`install.ts` already uses `execFile('git', [...])`). Two calls: `git symbolic-ref --short HEAD` to get the branch, and `git rev-list --count <base>..HEAD` to count ahead commits. Wrap both in try/catch so a missing base branch or detached HEAD falls through to the propose response.
2. **Use `simple-git` or another library** — Adds a dependency for three commands. No gain over `execFile` given the codebase already uses the latter.
3. **Read `.git/HEAD` directly** — Fragile, doesn't help with ahead-count.

### Rationale
Keeps parity with `install.ts` and `ship.ts`. No new deps. The only git commands needed are already available in any shipping context.

## Decision: base branch source

Use `ctx.configLoader.load()` to get `config.git?.pr_base ?? 'main'`, matching `ship.ts:17`. This guarantees `next` and `ship` agree on the target. Avoids hardcoding `main`.

## Decision: response shape and command string

`metta ship` requires `--branch <name>` (see `ship.ts:22-31`). Therefore `next`'s emitted command must be `metta ship --branch metta/<name>`. Returning bare `metta ship` would trip the ship command's "specify --branch" guard.

Final JSON shape:
```json
{
  "next": "ship",
  "action": "ship",
  "command": "metta ship --branch metta/<name>",
  "change": "<name>",
  "branch": "metta/<name>"
}
```

`change` is the branch name with the `metta/` prefix stripped.

## Decision: skill update

Add one line to `.claude/skills/metta-next/SKILL.md` Rules section: `If metta next says "ship", run /metta:ship (or execute the returned command) to merge.` Also update the template source at `src/templates/skills/metta-next/SKILL.md` — both files exist and must stay in sync.

## Decision: error tolerance

`git symbolic-ref` errors in detached HEAD — return propose. `git rev-list` errors when base branch doesn't exist — catch, return propose. Do not print git errors; the fallback is the expected behavior.

## Decision: tests

Add tests to `tests/cli.test.ts` under a new `describe('metta next post-finalize', ...)` block:
- seed a tmp repo, create `main`, create `metta/foo` with a commit ahead, run `metta next --json`, assert ship response
- seed same, zero commits ahead, assert propose response
- seed with HEAD on `main`, assert propose response

Skipping the "no main branch" scenario as an e2e test — unit-cover via the fallback path.

### Artifacts Produced
None — CLI refactor.
