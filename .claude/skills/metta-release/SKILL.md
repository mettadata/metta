---
name: metta:release
description: Cut a versioned release locally (bump, changelog, tag), then push and optionally publish a GitHub release with explicit confirmation
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-release
---

Drive the `metta release` CLI. The CLI owns version bumping, changelog rendering, tagging, and the `spec/releases.yaml` record; the cut is purely local. This skill gathers the user's decisions, passes them as explicit flags, and then handles the push and the optional GitHub publication — each gated on explicit user confirmation.

## Steps

1. Run `metta release status --json` first (allow-listed read-only; this also completes a Bash cycle so the session credential minted by the hook is in place before `cut`). Parse the output: current version, derived bump level (`recommendedBump`), target version, pending changes, and `githubRelease` (whether the config enables GitHub publication).

2. Use `AskUserQuestion` to confirm the release decisions:
   - **Bump level** — present the derived level as the recommended option alongside the other levels (`major | minor | patch`); the user may accept the derivation or override it.
   - **Target version** — show the version the chosen bump level produces and ask the user to confirm it before cutting.

3. Run `metta release cut --bump <level> --yes --json`. The cut is local-only: it bumps the version, updates the record and changelog, commits, and creates the annotated tag — it never touches the remote. Parse `version`, `tag`, and `notes` (the extracted changelog section for this version) from the JSON output.

4. Ask for explicit per-run push confirmation via `AskUserQuestion` — every run of this skill asks fresh; no prior answer or standing preference ever substitutes for it:
   - **Push the release?** — on yes, run `git push --follow-tags origin main` (the only push this skill may perform; never `--force`). On no, report the manual command `git push --follow-tags origin main` and stop here — the local release (commit and tag) stays intact for the user to push later.
   - **GitHub release** — only when the status output from step 1 shows `githubRelease: true`, also ask whether to publish a GitHub release after the push. If the config does not enable it, do not offer this option at all.

5. Publish the GitHub release — only after a confirmed, successful push in step 4 AND when the user opted in:
   - Probe first with `gh release view <tag>`. If the release already exists, skip creation and report that it was already published (idempotent re-run).
   - Otherwise create it, feeding the `notes` string from the cut `--json` output on stdin via a quoted heredoc:

     ```
     gh release create <tag> --verify-tag --title <tag> --notes-file - <<'NOTES'
     <notes from cut --json>
     NOTES
     ```

   - Any `gh` failure (missing binary, unauthenticated, create error) is warn-and-continue: name the cause, report the manual command `gh release create <tag> --verify-tag`, and continue — never unwind the push or the local release.

6. Echo the results back to the user: new version, tag name, changelog update, whether the push happened, and the GitHub release outcome (created, already existed, skipped, or failed with the manual command).

## Rules

- Always run `metta release status --json` before `cut`; never skip straight to `cut`.
- Never invent a bump level or target version; use the values derived by the CLI unless the user explicitly overrides the bump level.
- Never pass a GitHub flag to `cut` — the flag is removed and errors. GitHub publication happens only in step 5, after the tag is on the remote.
- Push only with explicit per-run user confirmation, only `git push --follow-tags origin main`, never `--force`.
- Only offer GitHub publication when the config enables it (`githubRelease: true` in status output); always pass `--verify-tag` to `gh release create` so gh aborts instead of creating a release from the wrong commit.
- If `cut` fails, report the failing step named in the CLI output verbatim; do not attempt git recovery yourself.
- Any `gh` failure after a successful push is warn-and-continue: report the manual `gh release create <tag> --verify-tag` command; never treat it as a release failure.
