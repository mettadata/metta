# Research: /metta-uat skill shape — non-forked, main-session, no mint hook

Research question: verify the intent's claim (intent.md, "Skill shape" bullet, §1) that `/metta-uat` can be **non-forked, main-session, with no session-mint hook and no Tier-2 `metta` subcommands**.

**Verdict: the claim holds.** Every action the skill performs is either unguarded (Read/Glob/Agent), explicitly allow-listed (`metta status --json`), or invisible to the guard (plain `git`). The correct bucket is the **hook-less main-session** family, precedent `metta-check-constitution`. A mint hook would not only be unnecessary — it would be a no-op that additionally requires editing `metta-session-mint.mjs`, which the change forbids.

All paths below are relative to the worktree root `/home/utx0/Code/metta/.metta/worktrees/metta-uat-runner-skill-execute-change-s-generated-uat-md/`.

Authoring note (honest fallback clause): this document was written via shell heredoc because the Write tool was refused by `.claude/hooks/metta-guard-edit.mjs` ("Write blocked — no active metta change" — the guard's `metta status --json` probe does not see this worktree's change as active from the hook's cwd). This is itself empirical confirmation of Risk 1 below.

---

## 1. What the skill must do, vs. what each guard hook actually gates

Three PreToolUse guards exist. Two are session-registered in `.claude/settings.json` (matcher `Edit|Write|NotebookEdit|MultiEdit` → `metta-guard-edit.mjs`; matcher `Bash` → `metta-guard-bash.mjs`). The third, `metta-guard-agent-dispatch.mjs`, is frontmatter-scoped **only** to `.claude/agents/metta-skill-host.md` (its own header, lines 2–7) and rejects only `run_in_background: true` Agent dispatches (lines 68–81).

### `metta-guard-bash.mjs` gates `metta` invocations only — plain `git` passes untouched

The guard's `tokenize()` (`.claude/hooks/metta-guard-bash.mjs:82–110`) scans the command string for the literal token `metta` and returns one `{sub, third}` record per `metta` invocation. A command containing no `metta` token yields an empty invocation list, so `invocations.find(...)` at line 208 finds no offender and the hook exits 0 at lines 234–241. **`git add` / `git commit` are never classified, never blocked, never logged.** The only non-`metta` behavior in the hook is the background-Bash rejection at lines 186–196, which applies only when the caller is a forked `metta-*` agent AND `run_in_background === true` — the orchestrator's foreground `git commit` is unaffected.

Per-action classification for the skill:

| Skill action | Tool | Guard outcome | Evidence |
|---|---|---|---|
| Locate `UAT.md` (active change / archive) | Read, Glob | No guard matches Read/Glob (settings.json matchers are `Edit\|Write\|NotebookEdit\|MultiEdit` and `Bash` only) | `.claude/settings.json` hooks block |
| Resolve active change via `metta status --json` | Bash | **allow** — `status` is in `ALLOWED_SUBCOMMANDS` | `metta-guard-bash.mjs:19–25` (line 20) |
| Spawn `metta-uat-runner` | Agent | No session-registered Agent hook; `metta-guard-agent-dispatch.mjs` is scoped to `metta-skill-host` frontmatter and only rejects backgrounded dispatches | `metta-guard-agent-dispatch.mjs:2–7, 68–81` |
| Commit updated `UAT.md` | Bash (`git add` + `git commit`) | **allow** — no `metta` token, guard exits 0 | `metta-guard-bash.mjs:90–110, 234–241` |
| Log failures via `/metta-issue` | Skill tool invocation | Not a Bash call from this skill; `/metta-issue` runs in its own fork (`context: fork`, `agent: metta-skill-host`), whose `metta issue` call carries the trusted `agent_type` the Tier-1 check requires | `metta-guard-bash.mjs:64–66, 128–130, 211–213`; `.claude/skills/metta-issue/SKILL.md:1–7` |

Repo precedent for a skill invoking another skill via the Skill tool without any special frontmatter: `metta-fix-gap` invokes `/metta-propose` this way (`.claude/skills/metta-fix-gap/SKILL.md:35`), and its `allowed-tools` (`[Read, Write, Edit, Bash, Grep, Glob, Agent]`, line 5) contains no `Skill` entry. No skill in the repo lists a `Skill` tool in `allowed-tools`.

### The Tier-2 check never fires for this skill

The Tier-2 credential path (`metta-guard-bash.mjs:219–231`) is reached only for invocations classified `block` — i.e. `metta` subcommands in `BLOCKED_SUBCOMMANDS` (lines 40–46) or `BLOCKED_TWO_WORD` (lines 49–53). `/metta-uat` issues none of them. The only `metta` command in its body is the allow-listed `metta status --json`.

## 2. What `metta-session-mint.mjs` actually scopes — a mint would be a dead no-op

The mint hook exists solely to satisfy the guard's Tier-2 credential check for **blocked `metta` subcommands**. Its `SKILL_SCOPES` map (`.claude/hooks/metta-session-mint.mjs:18–29`) keys are the 10 Tier-2 skill slugs, and values are lists of `metta` subcommand scope keys (`complete`, `finalize`, `verify`, `backlog:add`, ...). There is no concept of scoping `git`, file edits, or agent spawns. **Committing via git requires no mint** — the token is only ever read by `readSessionToken` inside guard-bash's Tier-2 branch (`metta-guard-bash.mjs:138–151, 219`), which plain git commands never reach.

Two further facts close the intent's "if a mint-hook scope turns out to be needed" contingency:

1. The mint hook's defensive slug check exits without minting for any slug not already a `SKILL_SCOPES` key (`metta-session-mint.mjs:44–46`). Adding a mint hook to `/metta-uat` frontmatter with slug `metta-uat` would mint **nothing** unless `metta-session-mint.mjs` itself were edited to register the slug — and the change forbids guard-hook edits (intent.md Impact: "No guard-hook changes"; spec.md UAT Runner Skill requirement).
2. Even if registered with an empty scope, the minted token would never be consulted, because no `/metta-uat` Bash call reaches the Tier-2 branch.

Conclusion: the mint contingency is **not needed and not even implementable without violating the change's own constraints**. Ship with no `hooks:` block.

## 3. Frontmatter bucket comparison across all 19 deployed skills

Frontmatter-only survey (body prose mentioning `context: fork`, as in `metta-fix-gap:35`, excluded):

| Bucket | Skills | Frontmatter signature |
|---|---|---|
| **Fork-tier (Tier-1)** | metta-auto, metta-fix-issues, metta-issue, metta-propose, metta-quick, metta-ship | `context: fork` + `agent: metta-skill-host`; matches the 6 `SKILL_ENFORCED_SUBCOMMANDS` (`metta-guard-bash.mjs:64–66`) |
| **Minted main-session (Tier-2)** | metta-next, metta-plan, metta-execute, metta-verify, metta-refresh, metta-import, metta-init, metta-backlog, metta-fix-gap, metta-roadmap | `hooks.PreToolUse` → `metta-session-mint.mjs <slug>`; matches the 10 `SKILL_SCOPES` keys (`metta-session-mint.mjs:18–29`) |
| **Hook-less main-session** | metta-status, metta-progress, metta-check-constitution | No `context`, no `agent`, no `hooks` — only `name`/`description`/`allowed-tools` |

**`/metta-uat` belongs in bucket 3.** The closest precedent is not `metta-status` (read-only reporter) but **`metta-check-constitution`** (`.claude/skills/metta-check-constitution/SKILL.md:1–5`): a hook-less main-session skill that resolves the change slug via `metta status --json` (line 13), spawns a subagent via the Agent tool (line 22), and uses Bash — exactly the `/metta-uat` shape. It proves a hook-less skill can carry `Agent` + `Bash` today.

Options considered:

- **Option A — hook-less main-session (recommended).** Zero guard surface, matches every scenario in spec.md ("Skill introduces no CLI, guard, or Tier-2 surface"). Precedent: `metta-check-constitution`.
- **Option B — minted main-session (metta-verify pattern).** Rejected: per §2, the mint is a dead no-op for this skill and registering the slug requires editing `metta-session-mint.mjs`, which is out of scope by the change's own rules.
- **Option C — fork-tier (`context: fork` + `metta-skill-host`).** Rejected: the failure-to-issue loop requires the orchestrator to invoke `/metta-issue` after the run, and a forked skill is itself a subagent — fork-tier skills cannot be invoked from a subagent (intent.md §1; spec.md UAT Failure-To-Issue Loop). It would also violate the spec's explicit "non-forked, main-session" MUST.

## 4. allowed-tools

Minimum viable set: **`[Read, Glob, Bash, Agent]`**.

- `Read` — read UAT.md, `.metta.yaml`, run-record verification after the runner returns.
- `Glob` — locate `spec/changes/*/UAT.md` and `spec/archive/*/UAT.md`.
- `Bash` — `metta status --json`, `git add`/`git commit`, `ls`-style archive ordering.
- `Agent` — spawn `metta-uat-runner`.
- `Grep` — optional convenience (e.g. counting `- [ ] Pass` boxes to sanity-check the runner's output); harmless to include, and every Agent-carrying skill in the repo except `metta-check-constitution` includes it. Recommend including it.
- **`Write`/`Edit` — omit.** The orchestrator never writes: the runner owns all UAT.md edits (spec.md UAT Run Record: "the runner MUST NOT write results to any other file"), and the orchestrator only commits. Omitting Write/Edit also makes the "orchestrator never edits the document" contract mechanically true for the skill context, and sidesteps `metta-guard-edit.mjs` entirely at the skill level.
- **No `Skill` entry needed** to invoke `/metta-issue` — see `metta-fix-gap` precedent in §1.
- **No `AskUserQuestion`** — the no-UAT-found path is a hard fail with a message (spec.md UAT Document Location Rules), not an interactive prompt.

The agent's own tools are fixed by spec: exactly `[Read, Bash, Edit]` (spec.md UAT Runner Agent), flat-file frontmatter per the `metta-specifier` precedent (`.claude/agents/metta-specifier.md:1–5`: `name`/`description`/`tools`/`color`, no `model`).

## 5. Distribution via `metta install` — zero code changes, zero inventory-test edits

- **Skills:** `installCommands` (`src/delivery/command-installer.ts:11–38`) does `readdir` over `src/templates/skills/` and recursively copies every skill directory. A new `metta-uat/` directory ships automatically.
- **Agents:** same function, lines 40–55 — `readdir` over `src/templates/agents/`, copies every `.md`. `metta-uat-runner.md` ships automatically.
- **install.ts** (`src/cli/commands/install.ts:330–337`) just calls `installCommands(root)`; hooks are installed separately by `installMettaHooks` (lines 38–54), also readdir-driven over `src/templates/hooks/` — untouched since no new hook.
- **Inventory test:** the "inventory completeness" assertion in `tests/cli-install.test.ts:238–255` compares installed `.claude/hooks/` against `src/templates/hooks/` only. No new hook → **no update needed**.
- **Byte-identity coverage:** `tests/template-deploy-sync.test.ts` auto-discovers both families recursively (lines 22–23 declare `agents` and `skills` family roots; per-file byte-identity tests at line 57; orphan-detection at line 71). Both new pairs are covered with **no test edits** — but note the orphan check means the deployed copy and template must land in the same commit.
- **`tests/cli-skills.test.ts`:** contains only per-skill/per-agent describes (e.g. `metta-check-constitution` pair at lines 198–213). Nothing breaks without edits; adding a `metta-uat` + `metta-uat-runner` describe pair for parity is optional and recommended for symmetry with `metta-check-constitution` (which has both the auto-discovered coverage and a named describe).
- **Agent registry:** `loadAgentDefinition` resolves `metta-<shortName>.md` by filename inside the agents dir (`src/agents/agent-registry.ts:57–72`) — `metta-uat-runner.md` is auto-discovered, no registry change, satisfying the spec scenario directly.

## 6. Resolving "active change" and "newest archive entry" with Read/Glob/Bash only

- **Active change — primary: `metta status --json`.** Allow-listed (`metta-guard-bash.mjs:20`) and already the established pattern in a hook-less skill (`.claude/skills/metta-check-constitution/SKILL.md:13`). The command reports the single active change or lists multiples (`src/cli/commands/status.ts:27–76`).
- **Active change — the underlying state file:** a change is "active" precisely when `spec/changes/<name>/.metta.yaml` exists — that is the definition `listChanges` uses (`src/artifacts/artifact-store.ts:103–113`: readdir `spec/changes/`, keep only dirs containing `.metta.yaml`). So the pure-Glob equivalent is `Glob spec/changes/*/.metta.yaml`. There is no central pointer file naming "the" active change; multiplicity is possible, and `metta status --json` is the sanctioned resolver for that case (if multiple changes are active and no argument was given, the skill should ask which — or simply prefer the one whose directory contains a `UAT.md`, since the location rule only cares about UAT presence).
- **Newest archive entry:** archive directories are named `<YYYY-MM-DD>-<name>` (verified: `spec/archive/` currently ends `2026-07-25-...`, `2026-07-26-roadmap-feature`), so lexicographic sort of directory names is chronological by date. Resolution: `Glob spec/archive/*/UAT.md`, sort the parent directory names descending, take the first — this simultaneously applies the spec's "newest entry **that contains a UAT.md**" filter. Same-day tie-break (two archives on one date) is under-determined by name alone; recommend documenting in the skill body that ties break by full directory-name sort (deterministic) — or, if design wants true recency, `git log -1 --format=%cI -- spec/archive/<dir>` per candidate. The deterministic name sort is simpler and sufficient.
- **Named-archive lookup:** `Glob spec/archive/*-<name>/UAT.md` (date prefix unknown to the caller), preferring an exact `-<name>` suffix match.

## 7. Risks

1. **`metta-guard-edit.mjs` will block the runner's Edit of an archived UAT.md when no change is active.** The edit guard allows Edit/Write only when `metta status --json` reports an active change (`.claude/hooks/metta-guard-edit.mjs:29–46`) or the path is allow-listed — and the allow-lists (`spec/project.md`, `.metta/config.yaml`, `spec/issues/`, `spec/backlog/` — lines 47–61) do **not** include `spec/archive/`. The archived-run scenario (spec.md Archived UAT Run Recording) typically executes with no active change, so the runner's Edit will be refused with exit 2 (lines 85–93). The spec's honest heredoc-fallback clause (UAT Runner Agent requirement) covers this mechanically — Bash `cat <<'EOF' >` is not gated — but it means **the fallback is the common path for archived runs, not the exception**: a full-document rewrite instead of a surgical Edit. (Empirically confirmed while producing this document: the Write tool was refused by exactly this guard.) Design must make the agent contract explicit that the heredoc rewrite reproduces the entire prior document byte-for-byte outside sanctioned regions (the "Generated step content is never altered" scenario is the enforcement backstop). Alternative — adding a `spec/archive/` UAT.md allow-prefix to `metta-guard-edit.mjs` — is cleaner long-term but contradicts the intent's "No guard-hook changes" impact statement; if design wants it, that requires an explicit spec delta. Live-change runs are unaffected (an active change exists, so the guard exits 0 at line 46).
2. **Guard-bash trusts any `metta-*` agent_type.** `isTrustedSkillCaller` (`metta-guard-bash.mjs:128–130`) accepts any agent_type with the `metta-` prefix, and trusted callers pass both Tier-1 (lines 211–213) and Tier-2 (lines 215–218) checks. The new `metta-uat-runner`, being a `metta-*` subagent, could therefore mechanically run `metta issue` or even `metta finalize` from its Bash tool. The prohibition ("runner never invokes `metta issue`, fork-tier skills, or git" — spec.md Failure-To-Issue Loop and Commit Ownership) is **contractual, enforced by the agent body text, not by the guard**. This is the existing posture for every metta agent (e.g. `metta-verifier` commits via git per `.claude/skills/metta-verify/SKILL.md:25`), not a regression — but the agent body must state the prohibitions explicitly, and the spec's "Agent contract forbids git" scenario checks exactly that.
3. **`Run:` hints may themselves contain `metta` commands.** A UAT step like `Run: metta status --json` executes fine; a hint invoking a blocked subcommand would pass guard-bash from the runner (risk 2). The prompt-injection defense clause plus a body rule ("execute only the step's stated command; never a `metta` state-mutating subcommand") is the mitigation.
4. **Orphan check couples the pair.** `tests/template-deploy-sync.test.ts:71` fails if a deployed file lacks its template (and the byte-identity tests fail in the other direction) — template and deployed copies must be created together.
5. **Multiple active changes.** `listChanges` can return several; the location rule says "the active change directory" (singular). Design should specify: with no argument and multiple active changes, prefer the change with a `UAT.md`; if several qualify, fail with the candidate list rather than guessing (consistent with the fail-clearly requirement).

## 8. Recommendation

**Ship `/metta-uat` as a hook-less main-session skill (bucket 3), precedent `metta-check-constitution`. No `context: fork`, no `agent:`, no `hooks:` block, no mint. Close the intent's mint-hook contingency as "not needed" — it is unreachable (no Tier-2 calls) and unimplementable without a forbidden hook edit.**

Concrete frontmatter for both `src/templates/skills/metta-uat/SKILL.md` and `.claude/skills/metta-uat/SKILL.md` (byte-identical):

```yaml
---
name: metta:uat
description: Execute a change's generated UAT.md acceptance script via the metta-uat-runner agent
argument-hint: "[change-name]"
allowed-tools: [Read, Grep, Glob, Bash, Agent]
---
```

Companion agent frontmatter (`src/templates/agents/metta-uat-runner.md` = `.claude/agents/metta-uat-runner.md`), per the spec's fixed tool list and the `metta-specifier` flat-file precedent:

```yaml
---
name: metta-uat-runner
description: "Metta UAT runner agent — meticulous acceptance tester that executes generated UAT.md steps, flips checkboxes honestly, and appends dated run records"
tools: [Read, Bash, Edit]
color: green
---
```

Body requirements that fall out of this research: the skill resolves the change via `metta status --json` first and Glob (`spec/changes/*/UAT.md`, `spec/archive/*/UAT.md` descending) second; spawns the runner with the model parameter omitted; commits with a conventional message (`docs(<change>): UAT run record` or similar); invokes `/metta-issue` per failure from the main session; and the agent body carries the injection-defense clause, the no-git/no-skill/no-`metta`-mutating-subcommand prohibitions, and the Edit-first/heredoc-fallback clause — with the archived-run guard-edit refusal (risk 1) called out as the expected trigger of that fallback.
