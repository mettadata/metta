# template-version-drift-detection-consumer-projects-stamp

## Problem

When metta is installed into a consumer project, `metta install` / `metta init` copy versioned assets — skills, agents, hooks, workflow and gate templates — into the project's `.claude/` and `.metta/` directories. Those copies are frozen at the version of the metta binary that wrote them, but nothing records which version that was.

When the developer later upgrades (or downgrades) the metta binary globally, the project's installed assets silently fall out of sync with the running binary: the CLI executes new-version logic while the project runs old-version skills, hook scripts, and templates. Drift accumulates invisibly — there is no warning, no stamped version to compare against, and no diagnostic. The failure mode is subtle misbehavior (skills invoking commands the binary no longer supports, hooks enforcing stale rules, templates missing new fields) rather than a clean error, which makes it expensive to diagnose. Every consumer project using metta across a binary upgrade is affected; the same applies in reverse when an older binary runs against a project stamped by a newer version.

## Proposal

Add version stamping and non-blocking drift detection:

1. **Stamp on install/init.** `metta install` and `metta init` write the running package version into a new top-level `installed_version` field in `.metta/config.yaml`. The field is added to the strict Zod `ProjectConfigSchema` (`src/schemas/project-config.ts`) and written via `setProjectField` (`src/config/config-writer.ts`). `metta install` always re-stamps, so re-running install after an upgrade clears drift.

2. **Check on every CLI invocation.** In the global `preAction` hook (`src/cli/index.ts`), compare the stamped `installed_version` against the running binary version using exact string inequality — any difference warns, including the downgrade case (binary older than stamp). No semver range logic. The check:
   - emits a one-line warning to stderr in human mode;
   - never blocks execution or changes exit codes;
   - is skipped for the `install` and `init` commands (they re-stamp);
   - silently skips when the config is missing, corrupt, or unreadable — the drift check must never break a CLI invocation;
   - emits no warning for legacy installs where `installed_version` is absent; the field appears at the next `metta install` or `metta init`.

3. **JSON surface.** When a mismatch was detected during the invocation, merge a `template_version_mismatch` object `{ installed, running }` into the `outputJson` payload (`src/cli/helpers.ts`). The field is absent when there is no mismatch.

4. **Doctor check.** Add a "Template freshness" check to `metta doctor`: pass when the stamp matches the binary version; warn on mismatch or on a missing stamp.

## Impact

- `src/schemas/project-config.ts` — `ProjectConfigSchema` gains an optional top-level `installed_version` string field; because the schema is strict, omitting this addition would reject stamped configs, so schema and stamping ship together. Existing configs without the field remain valid.
- `src/config/config-writer.ts` — `setProjectField` gains a caller for the new field; no behavioral change to the writer itself.
- `src/cli/index.ts` — the global `preAction` hook gains the drift check; every CLI invocation now performs one additional config read, with command-name gating for `install`/`init`.
- `src/cli/helpers.ts` — `outputJson` payloads may carry an additional `template_version_mismatch` field; consumers of `--json` output that reject unknown fields would need to tolerate it (additive, backward-compatible for tolerant parsers).
- `install` and `init` command flows — gain a re-stamp write to `.metta/config.yaml`.
- `metta doctor` — gains one new check; doctor output ordering/summary counts shift by one entry.
- Human-mode stderr — a new warning line may appear on any command when drift exists; scripts parsing stderr could observe it (stdout is unaffected).

## Out of Scope

- Semver-aware comparison, version ranges, or "compatible minor" logic — comparison is exact string inequality only.
- Automatic re-installation, migration, or self-healing of drifted templates — the warning tells the user to act; it does not act for them.
- Blocking behavior of any kind — no exit-code changes, no refusal to run on mismatch.
- Per-asset or per-file drift detection (hashing individual skills/hooks/templates) — only the single project-level version stamp is compared.
- Backfilling `installed_version` into existing projects outside of `metta install` / `metta init` — legacy projects gain the stamp only when they next run one of those commands.
- Warning or telemetry surfaces beyond stderr (human mode) and the `template_version_mismatch` JSON field — no log files, no notifications.
- Changes to how `install`/`init` copy assets, or to which assets are installed.
