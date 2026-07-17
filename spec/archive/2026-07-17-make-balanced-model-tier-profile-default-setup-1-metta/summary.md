# Verification Summary — make-balanced-model-tier-profile-default-setup-1-metta

**Verdict: PASS**

Verified against `intent.md` by exercising real behavior on a fresh build
(`npm run build`, implementation commit `b7a41f8ab`), 2026-07-17.

## 1. Fresh scaffold writes the balanced models block

- Ran `metta install --git-init` in a mktemp fixture. The scaffolded
  `.metta/config.yaml` contained:

  ```yaml
  models:
    # Model-tier routing: planning/review always top-tier; executors on
    # trivial/quick changes run sonnet. Alternatives: quality (all top-tier), budget (haiku/sonnet).
    profile: balanced
  ```

  The comment satisfies both intent requirements: (a) states the routing
  balanced implies (top-tier planning/review, sonnet trivial/quick executors)
  and (b) names both alternatives (`quality`, `budget`).
- Schema validity: `metta status --json` in the fixture exited 0; additionally
  `tests/cli-install.test.ts:77` (`scaffolds a schema-valid config.yaml with
  models.profile balanced`) parses the scaffold and asserts
  `ProjectConfigSchema.safeParse(...).success === true` — passing.
- Scaffold source: `src/cli/commands/install.ts:246-249` (models block appended
  to `configContent`, still written with `{ flag: 'wx' }`).

## 2. End-to-end routing proof (fixture, zero manual config)

In the same fixture, with no manual config edits:

1. `metta quick "fix a typo in the readme" --auto` → change `fix-typo-readme`
   created on the quick workflow (intent → implementation → verification).
2. Wrote a real 1-file intent, then `metta complete intent --change
   fix-typo-readme` → advanced to implementation.
3. `metta --json instructions implementation --change fix-typo-readme` →
   **`agent.model: "sonnet"`** (agent `metta-executor`), exit 0.

The balanced profile routes the quick-tier executor to sonnet straight from the
scaffold default.

## 3. Re-install preservation

- Edited the fixture config to `profile: quality`, re-ran `metta install`.
- After re-install: `profile: quality` intact, exactly one `models:` block and
  one `profile:` line — no overwrite, no duplication (the `wx` guard holds).
- Also covered by `tests/cli-install.test.ts:89` (`re-install preserves a
  user-edited config.yaml`) — passing.

## 4. This repo's config is live

- `/home/utx0/Code/metta/.metta/config.yaml:6-9` carries the `models:` block
  with the explanatory comment and `profile: balanced`; all pre-existing keys
  (`project.name`, `project.description`, `project.stacks`) untouched.
- `node dist/cli/index.js status --json` in this repo exits 0 (config passes
  schema validation).
- Live routing observation for this very change (quick-tier):
  `node dist/cli/index.js --json instructions implementation --change
  make-balanced-model-tier-profile-default-setup-1-metta` emitted
  **`agent.model: "sonnet"`** — the repo config is actively routing (observed
  only, not acted on).

## 5. Docs

`docs/guide/configuration.md:305` adds the `### \`models\`` section matching
the existing per-key pattern, with:

- role-immunity note (reviewer/verifier/planning always inherit,
  lines 307-311),
- absent-block semantics (removing `models` → everything inherits, line 311),
- three-profile routing table (`quality`/`balanced`/`budget`, lines 323-328),
- precedence rule (explicit `executor.<tier>` beats profile expansion,
  line 330),
- scaffold example and an explicit-override example.

No existing section changed. `docs/guide/getting-started.md` /
`docs/getting-started.md` do not embed the scaffold verbatim — re-checked, no
edit required (matches intent).

## Out-of-scope confirmation

`git show b7a41f8ab --stat` touches only `.metta/config.yaml`,
`docs/guide/configuration.md`, `src/cli/commands/install.ts`,
`tests/cli-install.test.ts` — `src/context/model-resolver.ts` and
`src/schemas/project-config.ts` (PROFILE_MAP, ModelProfileEnum,
resolveAgentModel, absent-config inherit semantics) are unchanged, as required.

## Gates

| Gate | Result |
|------|--------|
| `npx vitest run` | 87 files passed, 1449 tests passed, 0 failed (247s) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 (templates copied) |

## Verdict

**PASS** — all intent commitments verified with live evidence; routing proven
end-to-end in a fresh scaffold and in this repo; fixtures cleaned up.
