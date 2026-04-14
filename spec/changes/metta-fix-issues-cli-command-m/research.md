# Research: metta-fix-issues-cli-command-m

Strategy: mirror `fix-gap.ts` and the `metta-fix-gap` skill. This document confirms
the six decisions required by that strategy and surfaces every domain difference the
implementation must handle.

---

## 1. Severity Enum Divergence

**Confirmed difference.** The two domains use distinct enums.

- Gaps (`fix-gap.ts:10`): `critical | medium | low`
- Issues (`issues-store.ts:5`): `critical | major | minor`

`fix-gap.ts:12-16` maps `{ critical: 0, medium: 1, low: 2 }`. The issues enum must use:

```ts
const severityWeight: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
}
```

The `parseSeverity` heuristic in `fix-gap.ts:18-23` is not needed for issues — issues
already have a structured `**Severity**:` field parsed by `parseIssue` in
`issues-store.ts:46-47`. The `list()` method on `IssuesStore` (`issues-store.ts:78`)
already returns `severity` in the list item, so `fix-issue --all` can use
`issue.severity` directly without re-reading the raw file. This is a concrete
simplification over fix-gap, which must re-read each file to extract severity
(`fix-gap.ts:129-133`). The implementation should skip the raw-file re-read step.

The `--severity` filter token values must match the issues enum (`critical`, `major`,
`minor`). The help text and the JSON output key `severity_filter` should reflect the
issues tier names, not the gaps tier names.

---

## 2. Archive Destination

**Confirmed difference.** Archive paths are structurally different between domains.

- Gaps (`gaps-store.ts:144-148`): `spec/archive/<date>-<slug>-gap-resolved.md`
  — lives in the shared `spec/archive/` directory, prefixed with a date stamp.
- Issues (spec.md requirement `issues-store-archival`): `spec/issues/resolved/<slug>.md`
  — lives inside the issues subtree, no date prefix, plain slug filename.

The existing `spec/issues/resolved/` directory already exists (it contains
`tasks-in-tasks-md-arent-getting-checked-off-as-they-are-buil.md`), confirming the
pattern is in use. The archive method must `mkdir(join(specDir, 'issues', 'resolved'), { recursive: true })`.

The spec requires `archive` to be idempotent (overwrite if the resolved copy already
exists), whereas `gaps-store.ts:archive` makes no such guarantee. This is an explicit
behavioral addition.

---

## 3. IssuesStore.archive / remove Signatures

**Decision: separate methods, mirroring GapsStore.**

`GapsStore` exposes `archive(slug)` at line 142 and `remove(slug)` at line 134 as
independent methods. The caller (`fix-gap.ts:53-54`) calls them in sequence. The spec
(`issues-store-archival`) specifies the same two-method contract: `archive(slug): Promise<void>` and `remove(slug): Promise<void>`.

Key behavioral differences from GapsStore to implement:

- `archive` MUST call `exists(slug)` first and throw a descriptive error if not found
  (`gaps-store.ts:archive` does not guard on existence — it would throw opaquely on
  a missing file read).
- `archive` MUST be idempotent (spec requirement; gaps archive is not).
- `remove` MUST throw if the file is absent (`gaps-store.ts:remove` delegates to
  `state.delete` which uses `unlink` — this already throws on missing file, so the
  behavior is consistent by default, but it must be documented as intentional).
- GapsStore.archive returns `Promise<string>` (the archive path). IssuesStore.archive
  returns `Promise<void>`. The return type must not leak the path.

Do not collapse into a single `resolve()` method. The spec names `archive` and `remove`
explicitly and the CLI calls them in sequence, matching the gaps pattern exactly.

---

## 4. Skill Structure

**Confirmed: near-copy with targeted substitutions.**

The `metta-fix-gap` SKILL.md template is at `src/templates/skills/metta-fix-gap/SKILL.md`
(the `.claude/skills/metta-fix-gap/SKILL.md` is the deployed copy). The new skill goes
to `src/templates/skills/metta-fix-issues/SKILL.md` and deploys to
`.claude/skills/metta-fix-issues/SKILL.md`.

Substitutions required throughout the skill body:

| From (fix-gap) | To (fix-issues) |
|---|---|
| `fix-gap` | `fix-issue` (command name) |
| `fix-gap` | `fix-issues` (skill name) |
| `gap` / `gaps` | `issue` / `issues` |
| `metta:fix-gap` | `metta:fix-issues` (frontmatter `name:`) |
| `metta gaps list` | `metta issues list` |
| `metta gaps show` | `metta issue show` (check actual CLI) |
| `--remove-gap` | `--remove-issue` |
| `fix(gaps): remove resolved gap` | `fix(issues): remove resolved issue` |
| `spec/archive/` | `spec/issues/resolved/` |

The propose description pattern in the skill must be `"fix issue: <slug> — <title>"`
(spec requirement `skill-template`), matching the gaps pattern of `"fix gap: <slug> — <summary>"`.

No-argument mode: fix-gap skill prompts user to select a gap interactively. The fix-issues
skill does the same for issues. The interactive CLI invocation hint changes from
`/metta-fix-gap` to `/metta-fix-issues`.

The skill's pipeline structure (propose → plan → execute → review → verify → finalize →
merge → remove) is identical. No structural changes needed beyond substitution.

---

## 5. Commit Message Convention

**Decision: `fix(issues): remove resolved issue <slug>`**

This mirrors `fix-gap.ts:57` which uses `fix(gaps): remove resolved gap ${slug}`. The
spec (`fix-issue-cli-command` requirement) names this exact message:
`fix(issues): remove resolved issue <slug>`. Use it verbatim.

---

## 6. Git Add Paths

**Confirmed difference.**

- fix-gap (`fix-gap.ts:56`): stages `spec/gaps` and `spec/archive`
- fix-issue must stage: `spec/issues` and `spec/issues/resolved`

Since `spec/issues/resolved/` is a subdirectory of `spec/issues/`, staging `spec/issues`
alone (recursively) is sufficient. However, to match the two-argument pattern of fix-gap
and be explicit, stage both paths:

```ts
await execAsync('git', ['add', join('spec', 'issues'), join('spec', 'issues', 'resolved')], { cwd: ctx.projectRoot })
```

Alternatively, a single `join('spec', 'issues')` covers both because `resolved/` is
nested. Either is correct; the two-arg form is more explicit and consistent with
fix-gap's style. Recommendation: use two args for parity.

---

## Additional Difference: issue.show output fields

`fix-gap.ts:93-99` prints `source`, `claim`, `evidence`, `impact`, `relatedSpec` from
the `Gap` interface. The `Issue` interface (`issues-store.ts:6-13`) has different fields:
`title`, `captured`, `context`, `status`, `severity`, `description`. The single-slug
display branch must print `title`, `severity`, `status`, `description` (and `captured`
/ `context` if present) rather than the gap-specific fields. The spec scenario requires
that stdout includes "title, severity, and status" at minimum.

The delegate hint changes from:
`metta execute --skill fix-gap --target <slug>`
to:
`metta execute --skill fix-issues --target <slug>`

---

## Summary of Divergences

| Concern | GapsStore / fix-gap | IssuesStore / fix-issue |
|---|---|---|
| Severity enum | `critical\|medium\|low` | `critical\|major\|minor` |
| Severity in list() | Not returned; must re-read file | Returned directly; no re-read needed |
| Archive path | `spec/archive/<date>-<slug>-gap-resolved.md` | `spec/issues/resolved/<slug>.md` |
| Archive date prefix | Yes | No |
| Archive directory | Shared `spec/archive/` | Nested `spec/issues/resolved/` |
| archive() throws on missing | No (opaque) | Yes (explicit guard required) |
| archive() idempotent | Not guaranteed | Required |
| archive() return type | `Promise<string>` (path) | `Promise<void>` |
| Git add paths | `spec/gaps` + `spec/archive` | `spec/issues` + `spec/issues/resolved` |
| Commit message | `fix(gaps): remove resolved gap <slug>` | `fix(issues): remove resolved issue <slug>` |
| Show output fields | source, claim, evidence, impact, relatedSpec | captured, context, status, severity, description |
| Skill name (frontmatter) | `metta:fix-gap` | `metta:fix-issues` |
| Propose description | `"fix gap: <slug> — <summary>"` | `"fix issue: <slug> — <title>"` |
