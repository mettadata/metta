# Research: fix-issue-metta-install-should

## Open Question: Where does `metta refresh` go after discovery?

### What the code actually does today

**`metta install`** (`src/cli/commands/install.ts` lines 177-183) already calls `runRefresh` but does so
immediately after scaffolding directories — before the user has answered any discovery questions. At
that point `spec/project.md` only contains the stub constitution template, so the generated
`CLAUDE.md` carries empty Project / Conventions / Stack sections. Then `install` commits everything
(line 186-197), freezing that empty state.

**`metta init`** (`src/cli/commands/init.ts`) is a pure read: it scans the repo, builds a
`discovery` instructions payload, and emits JSON. It writes nothing and calls nothing — no refresh,
no commit. It returns before the discovery agent has spoken to the user.

**`metta:init` skill** (`src/templates/skills/metta-init/SKILL.md`) is the orchestrator. It:
1. Calls `metta init --json`
2. Spawns the `metta-discovery` agent with the payload
3. Reports what was generated

**`metta-discovery` agent** (`.claude/agents/metta-discovery.md`) does the actual writing: it fills
`spec/project.md`, `CLAUDE.md`, and `.metta/config.yaml`, then explicitly runs:
```
git add spec/project.md CLAUDE.md .metta/config.yaml && git commit -m "docs: generate project constitution"
```

**`runRefresh`** (`src/cli/commands/refresh.ts` lines 239-302) takes `(projectRoot, dryRun)`. No
other arguments. It writes `CLAUDE.md` by replacing marker-delimited sections derived from
`spec/project.md` and `spec/specs/`. It does NOT commit anything — it only writes the file.

### Verdict on the three options

**Option 2 (in `init.ts`) — Ruled out.** `init.ts` returns before the discovery agent writes
`spec/project.md`. Adding a refresh call there would read the still-empty stub constitution. Same
problem as the current `install.ts` call.

**Option 3 (in the discovery agent prompt) — Viable but wrong layer.** The agent already runs a
git commit. Appending a `metta refresh` call to the agent prompt would work technically, but it
means the agent is responsible for infrastructure plumbing. It also means the discovery agent needs
`Bash` tool access to shell out to `metta`, which it already has — but the precedent is bad. The
agent should own only the domain task (interview + write constitution). Refresh is framework
infrastructure.

**Option 1 (post-step in the skill body) — Correct.** The skill is the orchestrator; it already
controls sequencing. After the metta-discovery subagent returns, `spec/project.md` is guaranteed
written. The skill can then call `metta refresh` as a clean post-step before reporting to the user.
This keeps the agent focused on its domain task and keeps infra calls in the orchestration layer.

### Exact change required

In `src/templates/skills/metta-init/SKILL.md` (and its installed copy at
`.claude/skills/metta-init/SKILL.md`), add a step between the current step 3 and step 4:

```
3. **Spawn a metta-discovery agent** ... [unchanged]

3a. After the agent returns, run: `metta refresh`
    This regenerates CLAUDE.md from the now-populated spec/project.md.
    The agent already committed spec/project.md. Stage and commit the refreshed CLAUDE.md separately:
    `git add CLAUDE.md && git commit -m "chore: refresh CLAUDE.md after discovery"`

4. Report to user what was generated
```

Note: the discovery agent's commit instruction already includes `CLAUDE.md` in its `git add` list
(`git add spec/project.md CLAUDE.md .metta/config.yaml`). This must be reconciled. Two clean
options:
- Remove `CLAUDE.md` from the agent's commit and let the skill's post-step own it exclusively.
- Or have the skill's post-step amend the agent's commit (less clean, avoids extra commit).

Preferred: remove `CLAUDE.md` from the agent commit and have the skill call `metta refresh` + a
separate commit. This makes the agent's commit a pure constitution write and the skill's post-step
a pure CLAUDE.md sync — separation of concerns is clear.

The `metta refresh` CLI call in the skill body requires no arguments. It operates on `cwd`.

### Removing `runRefresh` from `install.ts`

The `runRefresh` call in `install.ts` lives at **lines 177-183**:

```typescript
try {
  const { runRefresh } = await import('./refresh.js')
  await runRefresh(root, false)
} catch {
  // Refresh failure doesn't block init
}
```

This block should be deleted. The `install` command's purpose is scaffolding (dirs, config, skills,
hooks, initial commit). CLAUDE.md generation from a real constitution belongs to the
`metta:init` skill flow, not the install step.

The human output at lines 214-230 does not print any line like `Created: CLAUDE.md`. There is no
`console.log` for CLAUDE.md in install's non-JSON path. No output text changes are needed.

The JSON output (lines 199-209) does not include a `claude_md` or `context_file` field. No JSON
schema changes needed.

### Test impact

`tests/cli.test.ts` contains all install tests (lines 45-103 and 151-200+). None of these tests
assert that `CLAUDE.md` exists after install, check its content, or verify `runRefresh` was called.
Removing the `runRefresh` call will not break any existing test.

`tests/refresh.test.ts` tests `runRefresh` as a pure unit — not invoked via install. Unaffected.

No other test file references `CLAUDE.md` in the context of install.

## Recommendation

**Option 1: post-step in the skill body.**

Placement: `src/templates/skills/metta-init/SKILL.md` (and `.claude/skills/metta-init/SKILL.md`),
new step 3a after the discovery agent returns.

Simultaneously:
- Remove `CLAUDE.md` from the discovery agent's `git add` line in `.claude/agents/metta-discovery.md`
  and `src/templates/agents/metta-discovery.md` (if a template copy exists).
- Delete the `runRefresh` import + call block from `src/cli/commands/install.ts` (lines 177-183).
- Verify no install test breaks (none will — confirmed above).
