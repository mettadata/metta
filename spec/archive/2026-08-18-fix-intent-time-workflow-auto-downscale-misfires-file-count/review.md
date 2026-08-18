# Review: fix-intent-time-workflow-auto-downscale-misfires-file-count

Three parallel reviews (correctness, security, quality) — round 1 on the full diff (main...HEAD).

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical findings. Loop exited after 1 iteration; all warnings resolved in follow-up commit 9b724ed84.

## Independently verified by reviewers

- Branch order and precedence: autoAccept → nonInteractive fail-closed → interactive prompt; `workflow_locked` justification precedence in all No paths; fail-closed genuinely reuses the decline path (escalation + banner, workflow/artifacts untouched, no prompt rendered).
- The `nonInteractive` predicate exactly mirrors `askYesNoDetailed`'s early return, making the non-TTY default-Yes structurally unreachable from the downscale call site — the viaDefault cause mapping is sound.
- Atomicity: `downscale_decision` folded into the single updateChange with workflow+artifacts; `StateStore.write` safeParses pre-persist; graph swap only after a successful write — no partial-application window in new code.
- After the change, exactly three non-interactive tier-change paths remain, all gated on `auto_accept_recommendation === true`; a crafted `## Impact` cannot flip the tier non-interactively.
- `askYesNoDetailed` refactor is a pure move — all four other call sites byte-identical in behavior; no injection vector into records (closed-set components, strict schemas, safeParse).
- T-I4 upscale-suite inversion correct (upscale branch structurally unreachable for that fixture); dedicated upscale tests unchanged and green.
- Spec delta: MODIFIED names verbatim in the base spec, ADDED names absent there; all 15 scenarios mapped to tests.

## Warnings and resolutions (commit 9b724ed84)

- **Security W1** — advisory `catch {}` swallowed a failed accept-path write after the auto-accept banner printed (console claims a collapse that never persisted). → stderr warning emitted in the catch.
- **Security W2** — repeated runs overwrote the single-slot escalation record, erasing deliberate justifications. → first-record-wins when from/to tiers match; still writes on a different pair.
- **Quality W1** — rewritten `AutoDownscalePromptAtIntent` carried the base spec's "or auto mode is off" disjunct into the fail-closed definition, contradicting the interactive-TTY mandate. → disjunct dropped; non-interactive is exactly non-TTY-or-json.
- **Quality W2** — locked interactive TTY half of `locked_change_defaults_to_no` untested. → in-process TTY test added ([y/N], empty answer keeps workflow, workflow_locked cause, no record).
- **3x suggestion** — nullable `acceptCause` could persist "...: null". → invariant throw + TS narrowing; cannot persist.
- Also: "MAY fire" → "MUST NOT fire" RFC fix in spec.md; dead `jsonMode` option annotated.

## Follow-ups logged

- Issue `auto-accepted-workflow-upscales-mutate-workflow-with-no` (minor/low): upscale paths still lack decision records (audit asymmetry) + post-impl upscale loads the target graph after its write.

## Accepted residuals (pre-existing)

- `StateStore.write` is direct writeFile (no temp+rename) — crash mid-write can corrupt `.metta.yaml`.
- Summary-time integration-level scenario covered at unit level (persist path untouched, sanctioned by design conformance mapping).
