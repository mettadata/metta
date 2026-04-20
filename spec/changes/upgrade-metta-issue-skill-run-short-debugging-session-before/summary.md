# Summary: upgrade-metta-issue-skill-run-short-debugging-session-before

Ships a root-cause-analysis-first `/metta-issue` skill so that logged tickets carry the debugging context captured at observation time, not just a symptom headline. Downstream fixers running `/metta-fix-issues` now see the structured RCA + Candidate Solutions at step 1 without changing the resolution flow.

## Deliverables

1. **`src/cli/helpers.ts`** — added `readPipedStdin(): Promise<string>` helper. Returns `''` immediately when stdin is a TTY; otherwise races a `data`/`end` listener against a 100 ms timeout, `pause()`/`unref()`s stdin on settle so the event loop can exit. Handles the pipe-with-no-data hang that `execFile` default stdio creates.

2. **`src/cli/commands/issue.ts`** — wired `readPipedStdin` into the `metta issue` action. When piped stdin contains a non-whitespace payload, it becomes the issue body; the positional argument becomes the title. TTY and empty-pipe paths fall back to today's description-as-body behavior. No new CLI flags.

3. **`src/issues/issues-store.ts`** — added two clarifying comment lines above the `parseIssue` description extraction to document why H2 `##` headings in the body are safe (no metadata `startsWith` predicate matches `##`). Zero functional change.

4. **`src/issues/issues-store.test.ts`** — new vitest file with 3 cases: freeform body round-trip, structured H2 body round-trip (title isolation + all three H2 sections preserved), metadata boundary guard (H2 at body start doesn't leak into severity). Uses isolated `mkdtempSync` directories; never touches real `spec/`. `vitest.config.ts` `include` expanded to `['tests/**/*.test.ts', 'src/**/*.test.ts']` so co-located tests run.

5. **`.claude/skills/metta-issue/SKILL.md`** — rewrite from 4-step log-and-stop to 7-step RCA-first flow. `allowed-tools` expanded to `[Bash, AskUserQuestion, Read, Grep, Glob]`. Steps: parse args → collect description → collect severity → `--quick` short-circuit → RCA session (Grep/Glob/Read + `git log`) → RCA-failure fallback with `> RCA skipped: <reason>` blockquote → write ticket via `printf '%s' "$BODY" | metta issue "$TITLE" --severity <level>`. Rules section forbids forwarding `--quick` to the CLI.

6. **`.claude/skills/metta-fix-issues/SKILL.md`** — step 1 (Validate) in the Single Issue Pipeline gains an explicit display instruction: after `metta issues show <slug> --json`, orchestrator renders the `## Symptom`, `## Root Cause Analysis` (with `### Evidence`), and `## Candidate Solutions` sections. Legacy issues without sections render raw body and continue — no error. Steps 2–11 unchanged byte-for-byte.

## Verification state

- `npx tsc --noEmit` clean
- `npm run lint` clean (aliased to `tsc --noEmit`)
- `npm run build` clean
- `npx vitest run` — 818/818 tests green across 58 files
- 3 new tests in `src/issues/issues-store.test.ts` pass
- 9 previously-timing-out CLI tests now pass after the `readPipedStdin` hardening
- All 3 reviewers (correctness / security / quality) PASS in round 2
- All 9 spec scenarios trace to either test evidence or skill instructions (see `verify/scenarios.md`)

## Additional fix during review

- `src/templates/skills/metta-issue/SKILL.md` and `src/templates/skills/metta-fix-issues/SKILL.md` resynced with their deployed copies under `.claude/skills/` after quality reviewer caught template drift in round 1 (commits `07aff46ad`, `8bf2cf307`). Secrets-exclusion rule added to the metta-issue skill Rules section (blocks RCA from reading `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets/`).

## Non-goals honored

- No migration of existing `spec/issues/*.md` files — the pass-through parser handles both shapes
- No change to `/metta-fix-issues` propose→plan→execute→review→verify→finalize→merge→remove flow (only step 1 display)
- No new CLI flags (`--body-file`, `--stdin`, `--rca`)
- No hard time or tool-call bounds on RCA
- No new npm dependencies (`node:stream/consumers` is a Node 22 built-in; removed after switching to explicit listener + timeout race)
