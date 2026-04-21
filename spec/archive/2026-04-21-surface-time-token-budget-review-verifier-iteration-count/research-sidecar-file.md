# Approach: Sidecar metrics file per change

## Summary

Introduce a new file `spec/changes/<change>/.metrics.yaml` with its own Zod
schema (e.g. `ChangeMetricsSchema`). The main `.metta.yaml` stays untouched;
all new data — timings, tokens, iteration counts — land in the sidecar.
`metta complete`, `metta instructions`, and `metta iteration record` all
write to the sidecar. Renderers read both files.

## Pros

- **Clean separation of concerns.** "Workflow state" (what stage, what
  workflow, what artifacts) stays distinct from "observability data"
  (how long, how many tokens, how many iterations).
- **Easier to remove later.** If metrics design changes, we can rename or
  drop the sidecar without touching core state.
- **No risk of breaking existing code paths** that read `.metta.yaml` —
  those parsers would not even see the new fields.

## Cons

- **Two files to keep consistent.** If `metta complete` writes to
  `.metta.yaml` but fails to write `.metrics.yaml`, timings drift from
  workflow state. Mitigation costs code (two writes inside a logical
  transaction, or an "eventually consistent" reconciler) that Approach A
  gets for free.
- **New schema file, new StateStore wrapper, new tests** for essentially
  the same four data points.
- **Archive/finalize complexity.** The finalize flow moves the whole
  change directory to `spec/archive/`. The sidecar goes with it — fine —
  but if a future spec merger or progress query expects a single file, it
  breaks.
- **The stated constraint says "no new telemetry infrastructure."** A
  separate metrics file with its own schema is exactly the infrastructure
  the backlog says to avoid.
- **Larger code delta.** Estimated ~250 LoC of source + ~350 LoC of tests.

## Fit with existing code

- Would require a new `MetricsStore` (or similar) that wraps
  `StateStore` and owns the sidecar's path + schema.
- Renderers would have to load both files — not hard, but doubles the
  read surface for progress/status.
- Finalize merges `spec/changes/<change>/*` into `spec/archive/...`;
  sidecar tags along "for free" but the spec-merger has no reason to care
  about it, which is the one correct behavior we'd get here.

## Complexity

**Medium.** New schema module, new store module, new tests for each,
double-write semantics in existing commands.

## Recommendation

**Rejected** relative to Approach A. The isolation benefit is mostly
cosmetic; the "two-writes" hazard and the doubled code surface outweigh
the cleanliness win. The scope note from the backlog explicitly says "no
new telemetry infrastructure" — this approach creates exactly that.
