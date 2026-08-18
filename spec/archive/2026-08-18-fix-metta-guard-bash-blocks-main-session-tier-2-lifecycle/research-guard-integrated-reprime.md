# Research: Deterministic Mint-Before-Validate — Guard-Integrated Re-Prime

Change: `fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle`
Approach evaluated: move Tier-2 freshness resolution entirely inside `metta-guard-bash.mjs` so the authorization outcome never depends on whether the separately scheduled mint hook's write has landed. The guard consults a non-forgeable "skill is active in this session" signal and re-primes/accepts the matching per-slug token itself before applying any expiry judgment.

## Approach

Two candidate shapes were investigated:

1. **Hook-ordering shape (rejected):** find or exploit a Claude Code mechanism that guarantees the mint hook completes before the guard reads. The docs are explicit that no such mechanism exists — "All matching hooks run in parallel" with no ordering field, no priority, no sequencing[^1]. Merging mint into the guard (one hook does mint-then-validate) also cannot work: the guard is registered project-wide in `.claude/settings.json` and has no way to know *which* skill is active — the per-skill slug is a static argv baked into each Tier-2 skill's frontmatter hook registration (`command: .claude/hooks/metta-session-mint.mjs metta-next` in `.claude/skills/metta-next/SKILL.md`), and that frontmatter registration event *is* the only trustworthy "this skill was genuinely invoked" signal. The guard therefore cannot absorb minting; it can only absorb **freshness resolution**.

2. **Guard-integrated re-prime (recommended shape):** the existing per-slug token file *is* the skill-activity marker — it is written only by the mint hook, which the runtime registers only when the skill is genuinely invoked, with a slug that never comes from command text. What the token currently lacks is (a) a binding to the session that minted it and (b) a guard-side rule for "expired but the minting skill session is still live." Add both: the mint hook stamps `sessionId` (from the runtime-supplied hook event, not from command text) into the token; the guard treats an expired-but-valid, in-scope token as **re-primable** when `token.sessionId === event.session_id` and the token is within a bounded grace horizon, rewrites `mintedAt` itself, authorizes the call, and logs a distinct acceptance reason. No dependence on the mint hook winning, losing, or even running on the evaluated event.

Why the token-as-marker is sound: Claude Code registers skill-frontmatter hooks "when you or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own turn as well"[^1]. So within one session, `token exists ∧ token.sessionId == current session_id` deterministically implies the skill was genuinely invoked in this session *and* its mint hook is still registered — the exact condition under which the pre-fix design intended the sliding refresh to keep the token alive. A separate marker file (e.g. `<slug>.active`) was considered and rejected: it would be written by the same machinery with the same trust properties, would equally go un-refreshed during subagent delegation windows (no main-session Bash events fire), and adds a second file to validate and clean up for zero additional evidence. A transcript-scan marker (guard parses `event.transcript_path` for a recent Skill invocation) was also rejected: the transcript format is undocumented/internal, parsing it in a fail-closed security hook is brittle, and the token+sessionId binding yields the same eligibility with two fields.

## How It Works (concrete mechanism)

### Files touched

| File | Change |
|---|---|
| `.claude/hooks/metta-session-mint.mjs` | Add `sessionId: event.session_id ?? null` to the minted token object (~line 101). Sibling-cleanup expiry test extended to `ttlMs + GRACE_MS` so a re-primable sibling is not deleted out from under the guard. |
| `.claude/hooks/metta-guard-bash.mjs` | Tier-2 evaluation (~lines 400–417): add the re-prime path described below; new audit reasons. Header comment updated. |
| `src/templates/hooks/metta-session-mint.mjs`, `src/templates/hooks/metta-guard-bash.mjs` | Byte-identical copies — enforced by `tests/hooks-byte-identity.test.ts`. |
| `tests/metta-session-mint.test.ts`, `tests/metta-guard-bash.test.ts`, new seam test (e.g. `tests/metta-guard-mint-seam.test.ts`) | Coverage per spec.md "Integration Tests Exercise the Mint/Validate Seam". |
| Hook headers + CLAUDE.md Tier-2 wording | Documentation sync (CLAUDE.md still describes the retired single-file `skill-session.token`; needs correction regardless). |

### Token schema (additive)

```json
{
  "token": "<randomUUID>",
  "skill": "metta-next",
  "subcommands": ["complete", "finalize"],
  "mintedAt": 1755500000000,
  "ttlMs": 300000,
  "sessionId": "<event.session_id from the hook event JSON>"
}
```

`validateToken()` in the guard checks only the existing five fields, so old-format tokens still validate; they simply lack `sessionId` and are therefore never re-primable — pre-fix behavior, fail-closed.

### Guard-side evaluation (replaces the bare check at guard ~line 403)

```js
const GRACE_MS = 3_600_000; // bounded re-prime horizon past raw TTL (sizing: see Failure Modes)

const tokens = readSessionTokens(event.cwd);
if (tokens.length === 0) { tier2Reason = 'missing-credential'; return true; }
const now = Date.now();
const fresh = tokens.filter((tok) => now - tok.mintedAt < tok.ttlMs);
// Deterministic re-prime eligibility: same live session (runtime-supplied
// session_id, never command text) AND within the bounded effective lifetime.
const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
const reprimable = tokens.filter((tok) =>
  sessionId !== null &&
  tok.sessionId === sessionId &&
  now - tok.mintedAt < tok.ttlMs + GRACE_MS
);
const eligible = [...fresh, ...reprimable];
if (eligible.length === 0) { tier2Reason = 'credential-expired'; return true; }
const key = /* unchanged scope-key derivation */;
const inScope = eligible.filter((tok) => tok.subcommands.includes(key));
if (inScope.length === 0) { tier2Reason = 'subcommand-not-in-scope'; return true; }
// If authorization came only via the re-prime path, rewrite the token
// (mintedAt = now, new random token value) at the SAME per-cwd path it was
// read from. Best-effort: a failed write never revokes the authorization.
if (!inScope.some((tok) => fresh.includes(tok))) {
  reprimeToken(event.cwd, inScope[0]); // write temp + rename for atomicity
  tier2AcceptReason = 'session-credential-reprimed';
}
```

Audit logging: acceptance via re-prime logs `reason: 'session-credential-reprimed'` (distinct from `'session-credential-verified'`, satisfying the "New acceptance paths are recorded distinctly" scenario); `'credential-expired'` is now written only when no token is fresh *and* no token is re-primable — i.e. genuinely dead credentials — satisfying audit-fidelity.

### Ordering invariance (the core property)

On the blocking Bash event, three interleavings are possible; all yield the same verdict:

- **Mint wrote first:** token is now fresh → normal `fresh` acceptance (`session-credential-verified`).
- **Guard read first (the losing race today):** token is expired-but-re-primable → guard authorizes and re-primes; when the mint hook's own write lands (before/after/concurrently), it writes an equally valid fresh token — last-writer-wins between two well-formed tokens is harmless.
- **Mint never fires** (e.g. subagent context, hook removed, future runtime change): guard re-prime is self-sufficient.

This satisfies the spec scenario "Authorization outcome is invariant under mint/guard hook ordering" by construction: the guard's branch conditions reference only the token file state and the event's own fields.

### Worktree-cwd resolution

Both hooks resolve the token dir from `event.cwd` (`mint` line 80–81, `guard` line 315). On any single event they receive the *same* `event.cwd`, so read-path and re-prime-write-path are symmetric by construction — the guard re-primes at exactly the path `readSessionTokens` resolved. Cross-event cwd asymmetry (mint at main checkout, later call from worktree cwd) surfaces as `missing-credential`, which the live audit log does not show and which intent.md explicitly scopes out as a fix target; the seam test still exercises both cwds as required, and any defect found there is logged as a separate issue.

## External Facts (Claude Code hook behavior)

All verified against the official hooks documentation on 2026-08-18 (the legacy `docs.anthropic.com/en/docs/claude-code/hooks` URL 301-redirects to `code.claude.com/docs/en/hooks`):

1. **Parallel, unordered execution — confirmed.** "All matching hooks run in parallel." No ordering, priority, or sequencing mechanism is documented for hooks on the same event. The same-event race in intent.md Problem item 2 is real and cannot be fixed by configuration.[^1]
2. **Skill-frontmatter hooks persist session-wide — confirmed.** "Skill hooks: Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own turn as well." This refutes the intent's alternative hypothesis that "the skill's frontmatter mint hook no longer applies to the later main-session call at all" — the mint hook *does* fire on the later `metta complete` event, in parallel with the guard. It also confirms the marker premise: within one session, a validly minted token implies a still-registered mint hook. An optional `once: true` field exists for frontmatter hooks ("runs once per session then is removed") — not useful here since we rely on the recurring fire.[^1]
3. **No Skill-invocation hook event.** `PreToolUse` matchers filter on tool name (`Bash`, `Edit|Write`, `mcp__.*`, ...); "Skill" is not a documented matcher value and no dedicated skill-invocation event exists. So there is no earlier, cleaner "skill was invoked" write point than the skill's first Bash call firing its frontmatter mint hook — which is what the current design already uses.[^1]
4. **`session_id` is a documented common input field** delivered to every hook event alongside `cwd`, `transcript_path`, `tool_name`, `tool_input`, and (in subagents) `agent_type`/`agent_id`. It originates from the runtime's event JSON on the hook's stdin, exactly like the `agent_type` field Tier 1 already trusts — same trust class, no new assumption.[^1]
5. **Undocumented: `session_id` stability across `--resume`/`--fork`.** `SessionStart` matchers include `resume` and `fork`, but the docs do not state whether a resumed session keeps its `session_id` or whether frontmatter-registered skill hooks survive a resume. Both possible answers are safe for this design (see Failure Modes), but the exact UX after resume should be confirmed empirically during UAT rather than assumed.[^1]

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-18

## Trust-Model Analysis

- **The authorizing signal never comes from command text.** Re-prime eligibility is derived from (a) a token file only the sanctioned mint/guard machinery writes, (b) the runtime-supplied `event.session_id`, and (c) the guard's own clock. The slug→scope mapping (`SKILL_SCOPES`) stays in the mint hook as the sole scope truth; the re-prime path contributes *freshness only, never scope* — an expired `metta-plan` token can never authorize `finalize` because scope filtering runs on the same `subcommands` array as today (spec scenario "Activity signal never widens scope" holds).
- **Session binding is the deterministic skill-activity check the spec asks for.** `token.sessionId === event.session_id` is checkable without any cross-hook coordination and is exactly as forgeable as Tier 1's `agent_type` — i.e. not forgeable via the Bash command string, because the guard reads it from the runtime event, not from anything the orchestrator authors.
- **Exposure widening is bounded and mostly *narrower* than the naive alternative.** Compared with simply raising `TTL_MS` (intent Proposal item 2 alone), session binding means a leftover token file from a crashed or previous session authorizes **nothing** in a new session (session_id mismatch → fail-closed), whereas a raised raw TTL would honor it for the full window. Within the minting session, effective authority becomes "union of invoked skills' scopes, for up to `ttl + GRACE` after the last main-session Bash call" — the exact accepted tradeoff the modified requirement records ("union persists for the session's lifetime while skill-session activity continues"), with properties (b) bounded lifetime and (c) idle-session expiry preserved by the grace horizon.
- **Pre-existing residual, unchanged:** the guard performs structural validation only — it never compares the token value against a server-side secret — so an orchestrator that deliberately writes a well-formed token file (Write tool, or a Bash heredoc the tokenizer does not scan for) can self-authorize today and could still do so after this change (it can also read `session_id` from its own environment). The spec's threat model already accepts this as "equivalent in required capability to disabling the guard itself," audit-visible on use. This approach neither narrows nor widens that residual; worth restating honestly in the design doc because the re-prime path makes the guard *itself* a token writer for the first time.
- **Guard becomes a state writer.** Previously read-only; now it rewrites a token on the re-prime path. Kept safe by: write is best-effort (authorization never depends on write success), same-path-as-read (no new resolution logic), temp-file+rename (no torn reads for the racing mint hook), and mode 0o600 matching mint.

## Failure Modes

Fail-open candidates (each checked):

1. **Unbounded self-re-prime loop** — if the guard re-primed any expired token unconditionally, every Tier-2 call would refresh it and credentials would never die. Prevented by the `GRACE_MS` horizon *measured from the last genuine mint/re-prime*: activity (main-session Bash calls → mint slide-refresh, or authorized Tier-2 calls → guard re-prime) extends life; pure idleness does not, and after `ttl + GRACE` with no activity the token is dead (`credential-expired`), satisfying the "Genuinely dead credentials still fail closed" scenario. Note the subtlety: guard re-prime resets `mintedAt`, so each authorized Tier-2 call does extend the window — this is by design (it *is* skill-session activity) and matches the spec's "while skill-session activity continues" wording, but the design doc must state it.
2. **Stale token from a previous session** — session_id mismatch → not re-primable → fail-closed. Strictly safer than a raw TTL raise.
3. **Concurrent mint+guard writes on the same event** — both write well-formed tokens; with temp+rename in both hooks, readers never see a torn file. Without the rename hardening, a torn read would make `validateToken` return null → fail-closed (a re-block, not a breach) — so even the unhardened race only risks the original symptom, never a bypass. Recommend the rename hardening in both hooks anyway.
4. **`event.session_id` absent or non-string** (older runtime, unexpected event shape) — re-prime path disabled entirely, guard degrades to exact pre-fix behavior. Fail-closed; UX regression only.
5. **Resume/fork changes `session_id`** — tokens from before the resume become non-re-primable; user re-invokes the skill (one `/metta-next`). Fail-closed, mildly annoying, should be confirmed in UAT. If resume *preserves* session_id but drops frontmatter hooks, the guard re-prime is self-sufficient and everything still works — this is a genuine robustness win over any mint-hook-dependent design.
6. **Guard re-prime write fails** (read-only fs, permissions) — call is still authorized (decision precedes write); next call may re-enter the re-prime path within GRACE. Never blocks.
7. **GRACE sizing.** The delegation windows in the audit evidence span well past 5 minutes; long execute/verify subagent runs can exceed 30–45 min. `GRACE_MS = 3_600_000` (1 h, effective lifetime 65 min from last activity) covers observed patterns while keeping idle exposure bounded; this is a tunable judgment call for the user, not a correctness parameter — every value keeps the mechanism fail-closed at the boundary.
8. **Sibling cleanup racing re-prime** — mint's `cleanupSiblings` currently deletes siblings past raw TTL; it must be taught the same `ttl + GRACE` horizon or it could delete a re-primable token on an unrelated Bash call. Small, contained change; missing it degrades to `missing-credential` (fail-closed), not a breach.

Testability: excellent. Both hooks are argv/stdin/filesystem-pure Node scripts already covered by `tests/metta-session-mint.test.ts`, `tests/metta-guard-bash.test.ts`, and `tests/cli-metta-guard-bash-integration.test.ts`. Every spec seam scenario maps to a deterministic test: write a token JSON with chosen `mintedAt`/`sessionId`, feed the guard an event with chosen `session_id`/`cwd`, assert exit code + audit line — no clock mocking beyond timestamp arithmetic, no hook-scheduler simulation needed (that is the point of the approach). The "same-event race" scenario is testable as "guard runs with the expired-but-eligible token and no mint refresh applied," exactly as spec.md scenario (c) phrases it.

## Effort & Blast Radius

- **Code:** ~5 lines in the mint hook (sessionId stamp + cleanup horizon), ~40–60 lines in the guard (re-prime filter, best-effort atomic rewrite, two audit reasons), mirrored byte-identically into the two `src/templates/hooks/` copies (`tests/hooks-byte-identity.test.ts` enforces this automatically). No TypeScript `src/` changes, no schema changes, no CLI changes.
- **Tests:** extend the two hook unit suites; one new seam integration test file covering spec scenarios (a)–(d) including both-cwd cases. All pre-existing guard tests should pass unmodified (fresh-token path, missing-credential, scope-mismatch, Tier-1, tokenization untouched) — matching the "Freshness Fix Leaves All Other Guard Behavior Unchanged" requirement.
- **Docs:** guard/mint header comments, CLAUDE.md Tier-2 paragraph (already stale — still cites the retired single-file `skill-session.token`), `docs/internals/guard-hooks.md`.
- **Blast radius:** confined to the two-hook seam plus templates/tests/docs. Rollback is trivial (revert two hooks + templates). The only behavioral change users see is the disappearance of false `credential-expired` blocks; every rejection path that exists today still exists.

## Verdict

**Recommend.** This approach directly discharges every ADDED/MODIFIED requirement in the change spec: freshness becomes a pure function of (token file, event fields, clock) — provably invariant under hook ordering because no branch references the mint hook at all; the activity signal (mint-written token + runtime-supplied `session_id` binding) is non-forgeable from command text to exactly the same standard as the existing Tier-1 `agent_type` check; the effective lifetime is lifecycle-aware yet bounded (session-scoped + grace horizon), which is strictly tighter than a bare TTL raise; and every uncertainty in the design (missing session_id, torn writes, failed re-prime writes, resume semantics) degrades fail-closed to today's behavior, never fail-open. It composes cleanly with intent Proposal item 2 (the grace horizon *is* the lifecycle-aware window, session-bound) rather than competing with it.

Caveats to carry into design:
1. `session_id` behavior across `--resume`/`--fork`/compaction is undocumented — add a UAT step; either outcome is safe but the post-resume UX ("re-invoke the skill once") should be known, not guessed.
2. Pick and record `GRACE_MS` (recommend 60 min) and record the widened-exposure tradeoff plus the "each authorized Tier-2 call extends the window" property in the threat model, as the modified requirement mandates.
3. Adopt temp-file+rename writes in both hooks and extend `cleanupSiblings` to the grace horizon, or the re-prime path can be starved by its own housekeeping (fail-closed nuisance, not a breach).
4. State honestly in the design that the guard now writes state and that the pre-existing forged-token-file residual is unchanged by this fix.
