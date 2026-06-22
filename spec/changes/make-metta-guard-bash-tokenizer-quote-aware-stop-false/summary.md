# Verification: make-metta-guard-bash-tokenizer-quote-aware-stop-false

Resolves issue `metta-guard-bash-hook-false-positive-quoted-free-text`.

**Verdict: PASS** — all four checks satisfied, all gates green.

## Verification strategy

`.metta/config.yaml` has no `verification:` block, so `verification_strategy` is
`null`. This is a legacy project (78 entries under `spec/archive/`, and the active
change carries `intent.md`), so no strategy was auto-defaulted. Per the explicit
task directive, the standard test/tsc/build gates were run directly. To configure
a project strategy going forward, run `/metta-init` or add to `.metta/config.yaml`:

```yaml
verification:
  strategy: tests_only  # or: cli_exit_codes | playwright | tmux_tui
  instructions: ""
```

No `verification_instructions` were provided.

## Checks

### Check 1 — both hook copies carry the skip-to-separator logic and are byte-identical: PASS

`.claude/hooks/metta-guard-bash.mjs:73-82` contains the new logic in the
`if (tokens[i] === 'metta')` branch: after pushing the invocation it does
`i += 1` then `while (i < tokens.length && !['&&', ';', '||', '|'].includes(tokens[i])) i++;`
followed by `i++` to consume the separator, then `continue` — replacing the old
`i += 3; continue`. This matches the "skip until separator" loop already used for
non-`metta` leading tokens.

Byte-identical confirmation:
- `diff .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs`
  -> no differences (exit 0). The two files are byte-identical.
- The suite's own assertion 'source and deployed hook are byte-identical'
  (`tests/metta-guard-bash.test.ts:376-379`) passes.

### Check 2 — dist reflects the patch (build propagated it): PASS

`diff src/templates/hooks/metta-guard-bash.mjs dist/templates/hooks/metta-guard-bash.mjs`
-> no differences (exit 0), confirmed both before and after a fresh `npm run build`
(which rm -rf's and re-copies `dist/templates/hooks`).

### Check 3 — fix preserves genuine detection (both directions asserted): PASS

`tests/metta-guard-bash.test.ts` adds two regression cases inside the per-hook
`describe`, so each runs against both the source template and the deployed mirror:
- A `metta status` invocation with a quoted free-text arg containing the
  metta + finalize substring -> asserts exit 0 (NOT blocked). This is the
  previously-failing false-positive case.
- Two genuine chained invocations joined by `&&` -> asserts exit 2 (STILL
  blocked). This proves the skip-to-separator change does not weaken real-chain
  detection.

Both directions are covered. Pre-existing chain coverage also still passes. The
fix only widens the allowed set to quoted-argument false-positives; it does not
loosen blocking of real chained invocations.

### Check 4 — matches issue Candidate Solution 1 and intent scope; full parser deferred: PASS

The implemented approach is exactly issue Candidate Solution 1 ("skip-to-separator
after recording an invocation"): advance to the next chain separator
(`&&`, `;`, `||`, `|`) instead of `i += 3; continue`, applied identically to both
hook copies with a regression test. The fully shell-quote-aware tokenizer
(Candidate Solution 2) is correctly listed under intent.md "Out of Scope" and
deferred, with the known residual edge case (a literal separator inside a quoted
string) documented as deferred follow-up.

## Gates

| Gate | Command | Result |
|------|---------|--------|
| Build | `npm run build` | PASS (exit 0; tsc + copy-templates) |
| Typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| Targeted tests | `npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts` | PASS — 92 tests passed (81 + 11), 0 failures |

The two new regression cases are present and green (run against both hook copies),
alongside the byte-identical assertion.

## Full-suite note (deliberate scoped decision)

The full `npm test` suite was intentionally NOT run due to documented host OOM
risk (issue `metta-finalize-hangs-...`, now fixed). Verification was scoped to the
two guard test files plus build and tsc, which fully exercise the changed code
path (`tokenize()` and both hook copies). This is a deliberate scope decision, not
a gap.

## Files verified

- `.claude/hooks/metta-guard-bash.mjs:73-86` — tokenize() skip-to-separator fix.
- `src/templates/hooks/metta-guard-bash.mjs` — byte-identical to the active hook.
- `dist/templates/hooks/metta-guard-bash.mjs` — regenerated, matches source.
- `tests/metta-guard-bash.test.ts` — two regression cases; byte-identical assertion.
