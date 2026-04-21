# Review: fix-three-deferred-review-followups

## Verdict: PASS (lean review per quick-mode)

### Scope assessment
- 14 files, 35 insertions, 30 deletions
- All 3 fixes address explicit Batch A review findings
- Byte-identical pairs confirmed (5 skill pairs + 1 hook pair)

### Correctness
- **Fix 1 (dedupe review-iteration)**: pre-loop `metta iteration record` call removed from 5 skill templates. In-loop step (a) call retained. First review round now counts exactly once.
- **Fix 2 (gate timing stamps)**: `instructions.ts` checks status before writing `artifact_timings`/`artifact_tokens`. Complete artifacts no longer get their timings overwritten.
- **Fix 3 (allow-list iteration)**: `iteration` added to `ALLOWED_SUBCOMMANDS` in both hook copies. Documents intent that the iteration-recording CLI doesn't need skill enforcement.

### Security
No new attack surface. Changes are subtractive (remove a call) or additive-narrow (add one allow-list entry, one status guard). `.strict()` schemas still reject negatives.

### Quality
Byte-identical pairs via `diff -q`. tsc clean. 85/85 targeted tests pass (full suite in flight).

### No criticals. Proceeding to verify.
