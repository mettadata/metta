---
name: metta:release
description: Cut a versioned release (bump, changelog, tag, optional GitHub release)
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-release
---

Drive the `metta release` CLI. The CLI owns version bumping, changelog rendering, tagging, and the `spec/releases.yaml` record; this skill only gathers the user's decisions and passes them as explicit flags.

## Steps

1. Run `metta release status --json` first (allow-listed read-only; this also completes a Bash cycle so the session credential minted by the hook is in place before `cut`). Parse the output: current version, derived bump level, target version, pending changes, and whether the config enables GitHub releases.

2. Use `AskUserQuestion` to confirm the release decisions:
   - **Bump level** — present the derived level as the recommended option alongside the other levels (`major | minor | patch`); the user may accept the derivation or override it.
   - **Target version** — show the version the chosen bump level produces and ask the user to confirm it before cutting.
   - **GitHub release** — only when the status output shows the config enables GitHub publication (`github_release: true`), ask whether to also publish a GitHub release. If the config does not enable it, do not offer this option at all.

3. Run `metta release cut --bump <level> --yes --json`, appending `--github` only when the user opted in at step 2.

4. Echo the results back to the user: new version, tag name, changelog update, and GitHub release URL if one was created. Then suggest the manual push command:

   ```
   git push --follow-tags origin main
   ```

   The skill NEVER pushes; pushing is the user's manual step.

## Rules

- Always run `metta release status --json` before `cut`; never skip straight to `cut`.
- Never invent a bump level or target version; use the values derived by the CLI unless the user explicitly overrides the bump level.
- Only offer GitHub publication when the config enables it; omit `--github` otherwise.
- Never run `git push` from this skill; only surface the suggested command.
- If `cut` fails, report the failing step named in the CLI output verbatim; do not attempt git recovery yourself.
