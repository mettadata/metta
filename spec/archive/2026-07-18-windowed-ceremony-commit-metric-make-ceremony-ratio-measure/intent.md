# windowed-ceremony-commit-metric-make-ceremony-ratio-measure

## Problem

The ceremony-commit ratio reported by `metta progress` is all-time only. `getCeremonyCommitRatio` in `src/util/ceremony-metrics.ts` runs a single unbounded `git log --format=%s` over the entire repo history, so the reported number (currently ~72% on this repo, 1404/1961) is dominated by pre-reform history. The v0.2 ceremony-reduction reforms are explicitly a thesis — "recent changes should generate a lower fraction of chore/docs ceremony commits" — but there is no instrument that can confirm or refute it: any improvement in recent commits is diluted to invisibility by thousands of historical commits in the denominator. Without a windowed view, the v0.2 acceptance question ("did ceremony actually go down?") cannot be answered empirically from `metta progress`, in either human or `--json` output.

## Proposal

Add a windowed variant of the ceremony-commit metric and surface it alongside the all-time figure in `metta progress`. This is the acceptance instrument for the v0.2 ceremony-reduction thesis.

1. **`src/util/ceremony-metrics.ts`** — `getCeremonyCommitRatio` gains an optional window parameter: a since-ref string. When provided, the git invocation becomes `git log <ref>..HEAD --format=%s` instead of the full-history `git log --format=%s`. The classification rule is unchanged: subjects matching `^(chore|docs)(\(.+\))?:` are ceremony; merge commits and unprefixed subjects count toward `total` only. The function MUST return `null` only when the git call fails (e.g. an unknown ref makes `<ref>..HEAD` unresolvable). An empty range MUST return `{ ceremony: 0, total: 0, ratio: 0 }` — a valid result for a fresh window, never conflated with the invalid-ref `null`. The existing never-throws contract is preserved.

2. **`src/cli/commands/progress.ts`** — compute both the all-time ratio (existing call, unchanged) and a default since-window ratio:
   - **Default window ref**: the most recent version tag, resolved best-effort via `git describe --tags --abbrev=0`. When no tag exists (e.g. consumer projects that never tag), the windowed line is omitted from human output and the JSON field carries the no-data value — never an error.
   - **Human output**: both figures on one line, e.g. `Ceremony commits: 72% all-time (1404/1961) · 58% since v0.2.1 (29/50)`. When no window is available, only the all-time portion is shown (current behavior preserved).
   - **`--json` output**: a new `ceremony_commit_ratio_windowed` field with shape `{ref, ceremony, total, rate} | null`, following the same no-data conventions as the existing `ceremony_commit_ratio` / `artifacts_per_small_change` / `model_escalation_rate` fields (explicit `null`, never a coerced 0).
   - **`--ceremony-since <ref>` flag** (optional): overrides the default window ref. An unknown ref MUST NOT crash the command — the windowed metric reports no data, naming the attempted ref, and the rest of `progress` renders normally.

3. **Tests** — extend `tests/ceremony-metrics.test.ts` (windowed counts in a fixture repo with a tag placed mid-history; invalid ref returns `null`; empty range returns zeros) and `tests/progress-ceremony-metrics.test.ts` (human and `--json` output both with and without a tag present; `--ceremony-since` override; no-tag omission of the windowed line).

## Impact

- **`src/util/ceremony-metrics.ts`** — `getCeremonyCommitRatio(projectRoot)` becomes `getCeremonyCommitRatio(projectRoot, sinceRef?)`. The existing single call site (`progress.ts`) passes no window today, so the all-time path and its `{ceremony, total, ratio} | null` return shape are backward compatible; existing callers and tests are unaffected. `getArtifactsPerSmallChange` and `getModelEscalationRate` are untouched.
- **`src/cli/commands/progress.ts`** — gains one git subprocess call (`git describe --tags --abbrev=0`, best-effort) and one additional `getCeremonyCommitRatio` call per invocation; the `progress` command gains the `--ceremony-since <ref>` option. Human output changes on one existing line (the `Ceremony commits:` line gains the `all-time` label and the `· since <ref>` segment when a window resolves). JSON output is additive only: the existing `ceremony_commit_ratio` field is unchanged; `ceremony_commit_ratio_windowed` is new.
- **JSON consumers** — anything parsing `metta progress --json` sees one new top-level key; no existing key changes shape or meaning.
- **Tests** — `tests/ceremony-metrics.test.ts` and `tests/progress-ceremony-metrics.test.ts` are extended; no existing test contracts change.
- **Empirical value** — the v0.2 ceremony-reduction reforms become checkable: run `metta progress` after tagging a release and compare the since-tag ratio against all-time.

## Out of Scope

- Changing the ceremony classification rule (`^(chore|docs)(\(.+\))?:`; merges and unprefixed subjects in total only) — unchanged in both windows.
- Date-based windows (`--since=<date>`), count-based windows (last N commits), or multiple simultaneous windows — the window is a single git ref.
- Windowing the other ceremony metrics (`artifacts_per_small_change`, `model_escalation_rate`).
- Creating, managing, or recommending version tags; any tagging automation. The default window merely reads the most recent existing tag.
- Historical trend storage, charts, or per-release time series — this is a point-in-time two-number comparison.
- Changes to any other CLI command's output or to the `--json` error envelope.
