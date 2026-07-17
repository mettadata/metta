# make-balanced-model-tier-profile-default-setup-1-metta

## Problem

The `models` configuration schema (`src/schemas/project-config.ts`, `ModelProfileEnum` =
`quality | balanced | budget`) and its resolver (`src/context/model-resolver.ts`,
`resolveAgentModel` / `PROFILE_MAP`) already let a project route trivial/quick-tier executor
work to a cheaper model (`balanced` → `sonnet`/`sonnet`, `budget` → `haiku`/`sonnet`) while
keeping the planning cohort, reviewer, and verifier pinned to the session's inherited (top-tier)
model. `metta progress` (per `spec/specs/instruction-contracts/spec.md`, "Escalation rate
reporting") is designed to compute and surface an escalation rate from the Rung-1 model-escalation
audit trail — but that signal only accumulates data when a project actually opts into a
non-default profile.

Two places currently leave this capability dormant:

1. **New projects get no opinion.** `metta install`'s config scaffold
   (`src/cli/commands/install.ts`, the `configContent` template literal at lines 242-246) writes
   only `project: { name, description, stack }` — no `models:` block at all. Every scaffolded
   project therefore runs every role at inherit until a human discovers the feature and opts in
   by hand. New users of the trivial/quick cost-routing feature never see it exists unless they
   read `docs/guide/configuration.md` end to end (which, per the current file, does not even
   document a `models` section) or the schema source directly.

2. **Metta's own repo config sets no opinion either.** `/home/utx0/Code/metta/.metta/config.yaml`
   (this repo's committed project config) has no `models:` block, so metta's own trivial/quick
   changes all run at inherit. The escalation-rate metric that `metta progress` is meant to report
   has no real data to compute from on metta's own change history, because the routing that would
   produce Rung-1 escalation audit records is never exercised here.

The people affected are: (a) every new-project adopter who runs `metta install` and inherits
whatever default the scaffold writes, and (b) the metta maintainers, who want the
escalation-rate experiment (defined in `spec/specs/instruction-contracts/spec.md`) to start
accumulating real signal from metta's own trivial/quick changes rather than staying at zero
indefinitely. The current default — no `models:` block, so every role resolves to inherit
everywhere — is not wrong per the spec (absent config intentionally means inherit; see "No models
configuration yields inherit" below), but it is the wrong *starting point* for new projects and
for this repo, because it silently forgoes the cost-routing feature the project already built and
means the escalation-rate telemetry has nothing to measure.

## Proposal

1. **Scaffold `models: profile: balanced` into every new project's config.** In
   `src/cli/commands/install.ts`, extend the `configContent` template written to
   `.metta/config.yaml` (currently lines 242-246) to append a `models:` block:

   ```yaml
   models:
     # balanced profile: top-tier model for planning/review, sonnet for trivial/quick executors.
     # Alternatives: profile: quality (inherit everywhere) or profile: budget (haiku on trivial).
     profile: balanced
   ```

   The exact comment wording is flexible, but it MUST be a single-line-per-thought YAML comment
   (not embedded in the value) that (a) states the routing balanced implies — top-tier model for
   planning/review, `sonnet` executors on trivial/quick changes — and (b) names both alternative
   profile values (`quality`, `budget`) as pointers for projects that want a different tradeoff.
   This is new scaffold-time content only; it does not change `ModelProfileEnum`,
   `PROFILE_MAP`, or `resolveAgentModel` in `src/context/model-resolver.ts` — the routing logic
   and profile definitions are unchanged, only what a fresh scaffold writes into `.metta/config.yaml`.

2. **Enable the same block in this repo's own config.** Add the identical `models: profile:
   balanced` block (with the same explanatory comment) to `/home/utx0/Code/metta/.metta/config.yaml`
   so metta's own trivial/quick changes route executors through `sonnet` starting now, and the
   Rung-1 escalation audit trail (and the `metta progress` escalation-rate computation defined in
   `spec/specs/instruction-contracts/spec.md`) begins accumulating real data from metta's own
   change history.

3. **Update test coverage and docs that show scaffold content.**
   - `tests/cli-install.test.ts` currently asserts scaffold behavior (e.g. the `stacksLines`
     idempotency check at lines 86-89) but does not yet assert on a `models:` block; add/extend
     assertions there confirming a freshly scaffolded `.metta/config.yaml` contains
     `profile: balanced` under `models:`.
   - `docs/guide/configuration.md` documents each top-level config key with a table and example
     YAML snippet (see the `project`, `defaults`, `providers`, `git` sections at lines 126-194) but
     currently has no `### \`models\`` section at all — add one, matching the existing per-key
     documentation pattern (field table + example snippet), and note the `quality` / `budget`
     alternatives.
   - `docs/guide/getting-started.md` and `docs/getting-started.md` were checked and do not show
     the scaffolded config verbatim (they only reference `.metta/config.yaml` by name), so no
     verbatim-content edit is required there; re-check at implementation time in case content has
     since changed.

## Impact

- **`src/cli/commands/install.ts`**: the `configContent` scaffold gains a `models:` block. Existing
  behavior for `project:` fields, stack detection/merging (`writeStacksToConfig`), gate-YAML
  scaffolding (`scaffoldGateYamls`), and the `{ flag: 'wx' }` never-overwrite-existing-file
  guard on `.metta/config.yaml` are all unaffected — this only changes what gets written the first
  time a config is created.
- **`/home/utx0/Code/metta/.metta/config.yaml`** (this repo): gains a `models:` block. All other
  keys (`project.name`, `project.description`, `project.stacks`) are untouched.
- **Absent-config semantics are explicitly preserved.** `src/context/model-resolver.ts`'s
  `resolveAgentModel` and the "No models configuration yields inherit for every emitted model
  field" scenario in `spec/specs/instruction-contracts/spec.md` (line 115) govern what happens when
  a project's config has *no* `models` key at all (or is fully absent, e.g. very old projects, or
  a project scaffolded before this change ships). That behavior — resolve to inherit — is not
  touched by this change. This change only affects the *content newly-scaffolded projects and this
  repo start with*; it does not add a default profile when config is silently missing, and does not
  change how the resolver treats a missing `models` key.
- **`tests/cli-install.test.ts`**: gains new assertions on scaffold content; existing assertions
  (idempotency, stack merging, guard-hook installation) are unaffected.
- **`docs/guide/configuration.md`**: gains a new `### \`models\`` section following the existing
  per-key documentation pattern; no existing section's content changes.
- **Existing installed projects**: this change only affects the scaffold path (`wx` flag — write
  only if the file does not already exist) and this repo's own committed config. It does not
  retroactively modify any other already-installed project's `.metta/config.yaml`.

## Out of Scope

- Changing what happens when `models` configuration is entirely absent (the inherit-everywhere
  behavior defined by `spec/specs/instruction-contracts/spec.md`'s "No models configuration yields
  inherit" scenario stays exactly as specified).
- Changing the definitions or routing logic of the `quality`, `balanced`, or `budget` profiles in
  `src/context/model-resolver.ts`'s `PROFILE_MAP`, or the `ModelProfileEnum` / `ModelsConfigSchema`
  shapes in `src/schemas/project-config.ts`.
- Adding new profiles beyond the existing three.
- Changing planning-cohort, reviewer, or verifier model resolution (these remain hard-pinned to
  inherit regardless of profile, per `spec/specs/instruction-contracts/spec.md`).
- Building or changing the `metta progress` escalation-rate computation/reporting itself — this
  change only creates the conditions (an active non-`quality` profile in this repo) for that
  existing feature to start accumulating data; the reporting logic is out of scope.
- Retroactively rewriting `.metta/config.yaml` in already-installed downstream projects (only the
  scaffold-time template and this repo's own file are touched).
- Any change to `metta config set`/`metta config edit` command behavior.
