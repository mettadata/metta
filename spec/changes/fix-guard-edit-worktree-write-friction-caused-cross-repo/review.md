# Review: fix-guard-edit-worktree-write-friction-caused-cross-repo (round 1)

Verdicts: Correctness FAIL (1 critical) - Security PASS_WITH_WARNINGS (1 major) - Quality PASS_WITH_WARNINGS

## Critical

1. [Correctness] `src/cli/commands/ship.ts:52` — `main-checkout-clean` step unreachable in the real finalize->ship flow. Ship runs after `metta finalize`, which archives the change (`spec/changes/<name>` moved to `spec/archive/`), so `ctx.artifactStore.getChange(changeName)` throws, the catch swallows it, `mainCheckout` stays undefined, the step is never emitted, and baseline cleanup is dead (baselines accumulate). Fix: resolve topology from durable evidence at ship time — `existsSync(join(ctx.projectRoot, '.metta/worktrees', changeName))` and/or the validated baseline file's `main_root` — and add a ship-level test that simulates the archived state and asserts step emission.

## Major

2. [Security] `.claude/hooks/metta-guard-bash.mjs` (`checkWriteTargets` / main insertion) — timeout DoS: targets are neither deduped nor capped; each spawns a sequential `git rev-parse` even for nonexistent paths. A command padded with many redirects can push the hook past the harness per-hook timeout — a killed hook means no block AND no audit entry, silently defeating the fail-closed metta-invocation scan. Fix: dedupe targets, cap count (~16), cache `resolveTargetRoot` per directory, internal wall-clock budget (~2s) that fails open explicitly and falls through to the offender scan.

## Warnings

3. [Correctness/Quality] guard-bash `extractWriteTargets` — heredoc BODY lines are scanned as command text: a legitimate worktree-targeted heredoc whose content contains `> /abs/main/path` is falsely blocked (over-block, not in the documented fail-open set). Fix: skip lines between `<<WORD` and the terminator, or at minimum document in KNOWN LIMITATION + add a test.
4. [Correctness] `src/cli/commands/complete.ts:240` — gate fails closed on git errors (generic `complete_error`), inconsistent with capture (warn) and ship step (fail-open skip). Wrap so only `MainTreeContaminationError` escapes.
5. [Correctness] `src/cli/helpers.ts:147` — custom `git.worktree.dir` silently disengages layer 3; the git cross-check is unreachable for non-default dirs. Thread the configured dir through or correct the doc comment.
6. [Security] `src/cli/commands/ship.ts:47-49` — branch-derived changeName used in filesystem paths without slug validation; add `assertSafeSlug` after the match, skip on failure.

## Minor / suggestions

7. guard-bash: unused `event` param in `checkWriteTargets`; `>|` redirect silently fail-open (undocumented); source-side mutations (`mv <main> /tmp`, `rm`, `sed -i`) undocumented residual; multi-change `{changes:[...]}` probe fail-open undocumented; `> /dev/null` pays a subprocess — short-circuit `/dev/`.
8. `complete.ts`/`merge-safety.ts` — control-char stripping when listing paths in human-readable output.
9. `ship.ts` — `as string` cast; baseline-read logic duplicated with `compareMainTree`.
10. `install.ts` gitignore fix reaches only new installs (`wx` flag) — follow-up migration candidate.

## Follow-up issue candidates (not this change)
- reviewer/specifier/uat-runner path-anchoring parity (relative `review.md` writes).
- gitignore migration for existing consumer installs.
- legacy `preflight` still hard-fails operator-dirty main when shipping from main (inherited behavior).

## Clean
Hook and template mirrors byte-identical; D8 placement + token-untouched invariant pinned; `path.relative` containment immune to prefix tricks; porcelain `-z`/rename parsing correct; write-once capture; complete gate placement correct; non-worktree step-list byte-identity pinned; no argument injection (execFile fixed argv); audit-log JSON-line integrity; YAML injection blocked by Zod+serializer.

# Review round 2 (post-fix commits ad8e9c813, aaee4ace4, eac6c0950)

Verdicts: Correctness PASS_WITH_WARNINGS - Security PASS_WITH_WARNINGS - Quality FAIL (1 blocking item)

Round-1 critical (ship wiring) and major (guard-bash DoS) verified genuinely resolved end-to-end; blocked-never-reprimes invariant holds; zeus shape still blocked after heredoc stripping; cap/budget cannot displace an early real target.

## Critical
1. [Quality] `tests/cli-ship-worktree.test.ts:27` — describe lacks `{ timeout: 60_000 }`; two CLI-spawning tests exceed vitest's default 5s under full-suite load — `npm test` fails deterministically (2/2690, 3/3 runs) while the file passes in isolation. Fix: add the describe-level timeout like every other CLI-spawning suite.

## Warnings (address now, cheap)
2. [Correctness/Security] guard-bash KNOWN LIMITATION additions: (a) arithmetic `<<` (`$((1<<2))`) misparsed as heredoc — swallows later lines incl. real `> /main/path` redirects (fail-open miss); optionally refuse pure-numeric heredoc terminators; (b) escaped `\<\<` form; (c) header overstates "escaped operators only false-block".
3. [Correctness/Quality] `src/ship/merge-safety.ts` `main-checkout-clean` detail interpolates raw dirt paths (terminal-escape class fixed in complete.ts only); apply stripControlChars to paths joins.

## Suggestions (optional)
4. Silent cap/budget fail-open lacks an audit entry (`write-target-budget-exhausted`).
5. `ship.ts:46` — `--branch ""` bypasses friendly missing-branch message; ship.ts double `readBaselineEntries` read.
6. `complete.ts` stripControlChars misses C1 range (`\x80-\x9f`).

# Review round 3 (post-fix commits 5564054da, 8ce031a0b) — FINAL

Verdicts: Correctness PASS - Security PASS - Quality PASS

All round-2 findings resolved with test coverage: describe timeout fixed (full suite 133 files / 2697 passed / 0 failed, exit 0), merge-safety + complete control-char stripping (C0+DEL+C1), arithmetic-<< phantom-terminator refusal (pure-numeric heredoc terminators rejected, residuals honestly documented), cap/budget audit entries (write-target-cap-exceeded / write-target-budget-exhausted), empty-branch guard, cached baseline read. Hook copies byte-identical; blocked-never-reprimes invariant intact.

Non-blocking suggestions carried as follow-ups: shared stripControlChars util (tracked by existing issue text-mode-stderr-c1-sanitization-residuals-1-src-cli), hex/base numeric-literal terminator forms, C1 escaping in audit JSONL, cachedBaseline type tightening, vitest onTaskUpdate flake (environmental, predates change).
