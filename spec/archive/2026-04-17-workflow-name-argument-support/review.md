# Code Review: workflow-name-argument-support

## Final verdict: PASS (after fix commits `156bae4d9` and `39bfe7762`)

## Fixes applied to resolve NEEDS_CHANGES findings

1. **Critical (artifact-loop note over-claim):** replaced in all four skill files (source + deployed mirrors) with factually accurate text naming `full` as not yet end-to-end usable and pointing at issue `full-workflow-references-missing-template-files-domain-resea`.
2. **Logged follow-up issue** via `metta issue` for the missing `full`-workflow templates (severity major).
3. **Intent contradiction:** `intent.md` Impact + Out-of-Scope sections updated to reflect the REQ-3 byte-identity sync of deployed skills.
4. **Slug placeholder:** replaced shorthand `full-workflow-missing-artifact-templates` with the real CLI-generated slug in all four skill files.

Byte-identity re-verified empty between source and deployed. 526/526 tests pass. `tsc --noEmit` clean.

---

## Original review findings

## Summary

The change threads a `--workflow <name>` flag through the `/metta-propose` and `/metta-auto` skill templates with identical parsing wording in both files and tests restored to the REQ-3 byte-identity form. However, the artifact-loop note that claims `metta instructions <artifact> --json` handles `domain-research`, `architecture`, and `ux-spec` stages "automatically" is inaccurate: the required artifact templates (`domain-research.md`, `architecture.md`, `ux-spec.md`) do not exist under `src/templates/artifacts/`, so `metta instructions` will throw `Template '<name>.md' not found` for those stages. The skill's core rewrite (step 1) is correct and consistent; the supplementary note over-promises.

## Issues Found

### Critical (must fix)

- `src/templates/skills/metta-propose/SKILL.md:58` and `src/templates/skills/metta-auto/SKILL.md:35` — The note claims `metta instructions <artifact> --json` returns the correct agent persona for `domain-research`, `architecture`, and `ux-spec` stages and that no per-stage special-casing is needed. In reality, `TemplateEngine.load()` (`src/templates/template-engine.ts:22-32`) throws `Template '<name>.md' not found` because `src/templates/artifacts/` contains only `design.md, execute.md, intent.md, research.md, spec.md, stories.md, tasks.md, verify.md` — there are no `domain-research.md`, `architecture.md`, or `ux-spec.md` templates. `full.yaml:8,48,64` still references them as `template: domain-research.md|architecture.md|ux-spec.md`. An orchestrator following this note against `--workflow full` will hit a hard error at the first extra stage and have no guidance for how to proceed. Either (a) scope-bound the note to only the stages that currently have templates, (b) mark `full` workflow as not-yet-supported in the skills until the missing templates land, or (c) ship the three missing artifact templates alongside this change. The intent.md "Impact" section claims "all ten `full`-workflow artifacts via the existing loop" will work, which is false given the missing templates.

### Warnings (should fix)

- `src/templates/skills/metta-propose/SKILL.md:14-17` and `src/templates/skills/metta-auto/SKILL.md:14-17` — The parsing rule is under-specified for hostile/ambiguous `$ARGUMENTS`. There is no guidance for: (1) `--workflow` appearing with no trailing token (end-of-string), (2) a value that itself begins with `--` (e.g. `--workflow --json` would silently consume `--json` as the workflow name), (3) prefix collisions such as `--workflow-cli` (the token is not the literal `--workflow` but an inattentive orchestrator may treat it as one), (4) multiple `--workflow` tokens. The current safety net is "the CLI will reject unknown values," which only catches cases 1 and 2 after the fact and does not catch case 3 at all. Tighten the wording to require an exact `--workflow` token followed by a non-flag token, or call out these edge cases explicitly.

- `spec/changes/workflow-name-argument-support/intent.md:38` — "Out of Scope" states the installed `.claude/skills/` copies are not modified, but commit `090765ff3` (`fix: sync deployed skills to source to preserve REQ-3 byte-identity`) deliberately updated them to keep byte-identity tests green. This is a benign contradiction between the intent's out-of-scope list and the actual commit history; update the intent or archive a note so future readers are not confused about whether deployed copies are in scope.

### Suggestions (nice to have)

- `src/templates/skills/metta-propose/SKILL.md:17` and `src/templates/skills/metta-auto/SKILL.md:17` — Minor wording polish: "Valid names are owned by the CLI (`standard` default, also `quick`, `full`)" reads slightly oddly. Consider: "The CLI owns the list of valid workflow names (`standard` is the default; `quick` and `full` are also accepted). Do NOT validate here — pass the value through and let `metta propose` surface any error."

- `src/templates/skills/metta-auto/SKILL.md:22` vs `src/templates/skills/metta-propose/SKILL.md:22` — The propose skill mentions the branch name (`creates change on branch metta/<change-name>`) while the auto skill only says `creates change`. This was a pre-existing asymmetry, not introduced by this change, but fixing it would bring the step-1 blocks fully into parity.

- `tests/grounding.test.ts` and `tests/skill-discovery-loop.test.ts` — After the restore commit these files contain no lingering comments, dead code, or 4-assertion substring checks from the first attempt. Clean. (No action required.)

- `tests/delivery.test.ts` — No assertions on literal step-1 wording of either SKILL.md, so the delivery suite continues to pass unchanged. Confirmed by running `npx vitest run tests/grounding.test.ts tests/skill-discovery-loop.test.ts tests/delivery.test.ts` — 25/25 pass. (No action required.)

## Verdict

NEEDS_CHANGES

The critical issue is the artifact-loop note's claim that `full`-workflow stages "automatically" work via `metta instructions` — they do not, because three required artifact templates are missing from `src/templates/artifacts/`. An orchestrator following this guidance will crash the first time it runs `metta instructions domain-research --json` on a `full` change. Fix by either (a) removing or narrowing the note, (b) adding the three missing templates (`domain-research.md`, `architecture.md`, `ux-spec.md`), or (c) documenting `full` as unsupported from skills until the templates ship. The warning-level parsing-edge-case gap should also be tightened before this lands for real users.
