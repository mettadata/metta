# Research: fix-generated-workflow-primer-contradicts-bash-guard-blanket

## Decision: Scoped wording rewrite with enumerated read-only list, hardened by a primer↔hook seam test

### Approaches Considered

1. **Scoped wording rewrite with enumerated read-only list (hand-synced)** (selected) — Rewrite `MANDATE` (lines 11–13) and the Forbidden bullet (line 60) in `src/delivery/workflow-primer.ts` to scope the ban to state-mutating commands, name `metta-guard-bash` as the enforcement authority, and add a "Read-only queries (permitted directly)" subsection enumerating the hook's current allow surface; sync `docs/workflows/README.md` and metta's own CLAUDE.md region; add cross-referencing sync comments in both primer and hook. Smallest viable surface (one source file, one test file, one docs file, comment-only hook edit), zero runtime/build coupling, propagates through the existing refresh/init paths, and matches the already-written spec.md exactly. Drift-recurrence risk is neutralized with a test-only mirror check (details in research-scoped-wording.md).
2. **Shared manifest consumed by hook and primer** — Rejected. Mechanically feasible (a sibling `.mjs`/JSON in `src/templates/hooks/` ships automatically through existing copy paths), but unjustified for a docs-drift bug: it re-architects the *correct* component (a deliberately self-contained security hook) to fix the *incorrect* one (primer strings). The only safe load strategy (dynamic import + exit 2) introduces a new whole-session all-Bash-blocked failure state; the unsafe strategy (static import) silently disables the guard on a missing manifest, because Claude Code treats exit 1 as non-blocking (per hooks docs). And it still does not make drift structurally impossible — installed-hook-copy vs package-dist skew survives. ~1.5–2 days of effort touching a security-critical hook vs hours for the wording fix. Details in research-shared-manifest.md.
3. **Generic wording fix without an enumerated list** — Not selected as-is, but two of its findings are folded into the selected approach. Pure generic wording has near-zero drift surface and fully cures the false-prohibition half of the zeus failure, yet only partially fixes discoverability — sessions learn a permitted surface *exists* but not that `metta milestone show` specifically does, and drill-down help (`metta milestone --help`) is itself blocked. The change's spec.md already mandates the enumerated list, so the enumeration stays; adopted from this track: the bare-`metta` pointer (bare `metta` is guard-allowed and prints the full command listing — a zero-drift, self-updating discovery channel) and confirmation that the fail-closed guidance is verifiably safe (`classify()` → `'unknown'` → exit 2; no fall-through allow). Details in research-generic-wording.md.

### Rationale

The bug is documentation drift, not enforcement error — the hook was never wrong. The fix therefore belongs in the wording, delivered through the same refresh path that propagated the wrong wording. The selected approach is the only one consistent with (a) the change's already-committed spec.md (five requirements, 17 scenarios, written against the enumerated-list design), (b) the project constraint that hooks stay standalone `.mjs` with no runtime coupling, and (c) the issue evidence that discoverability — a concrete command list — was the costly half of the zeus failure.

The one real weakness of hand-syncing — drift recurrence — is addressed two ways:
- **Fail-closed guidance** converts future drift from "false prohibition" (hours lost, wrong answers) into "harmless blocked attempt": the primer explicitly qualifies the list as mirroring the hook at generation time and instructs sessions to attempt uncertain commands, because the guard fails closed.
- **Seam test (recommended, test-only)**: a Vitest case in `tests/delivery.test.ts` that regex-extracts the hook's `ALLOWED_SUBCOMMANDS` / `ALLOWED_TWO_WORD` / `ALLOWED_BARE` entries and asserts each appears in `workflowPrimerLong()`. This is the codebase's established pattern for cross-standalone-file consistency (precedent: the ADR-4 `GRACE_MS` constant pin in `tests/metta-guard-mint-seam.test.ts`) and delivers most of the shared-manifest guarantee at ~30 lines of test code with zero runtime coupling.

Key implementation facts verified by the researchers:
- The hook surface has grown beyond the issue text and the change's spec.md already captures it correctly: `verify` is blocked; `backlog migrate`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut` blocked two-word forms; bare `backlog`/`release`/`roadmap` allowed.
- The identical-mandate invariant across both primer variants is structural (one shared `MANDATE` constant) but untested — the new tests should pin it.
- Test impact is confined to `tests/delivery.test.ts` (one existing assertion at line 61 pins the old mandate opening); refresh structural tests and all four guard test suites are unaffected by a comment-only hook edit.
- Wording nuance: `iteration`/`model-escalation`/`tokens` are instrumentation appenders and `install` is a pass-through — the "read-only" subsection title stays (spec fixes it) but body prose hedges accordingly.
- `docs/internals/guard-hooks.md` carries a fourth hand-synced copy of the lists; it appears current and is out of this change's scope (candidate follow-up note).

### Artifacts Produced

- [Research: scoped wording rewrite (selected)](research-scoped-wording.md)
- [Research: shared manifest (rejected)](research-shared-manifest.md)
- [Research: generic wording (partially folded in)](research-generic-wording.md)
