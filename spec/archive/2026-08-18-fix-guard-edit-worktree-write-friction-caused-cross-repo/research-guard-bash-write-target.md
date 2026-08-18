# Research: guard-bash write-target checking

Approach under evaluation: extend `.claude/hooks/metta-guard-bash.mjs` (and its shipped
template counterpart) to extract bash write targets (redirections, heredoc-fed
redirections, `tee`, `cp`/`mv` destinations) and block, with exit 2, any absolute target
that resolves into the MAIN checkout while the active change is worktree-hosted.

## 1. Current state

### 1.1 guard-bash structure (`.claude/hooks/metta-guard-bash.mjs`)

- Fully synchronous, dependency-free (only `node:fs`, `node:path`, `node:crypto`), reads
  the PreToolUse event JSON from fd 0 (`readStdin`, line 117) and exits 0 (allow) or 2
  (block with stderr). `main()` at line 405 runs on module load (no export guard).
- It analyzes **only `metta <cmd>` invocations**. The pipeline is:
  - `CHAIN_SEPARATOR_RE` (line 129) + quote-aware segmentation
    (`splitCommandSegments`, lines 223–243) splits the command into
    chain-separator-delimited segments, splitting only at unquoted separator runs.
  - `computeQuoteMask` (lines 161–174) is a light single/double-quote state tracker —
    explicitly not a shell-grammar parser (no backslash escapes, no ANSI-C quoting), with
    a documented `unterminated` fail-closed fallback.
  - `tokenize` (lines 245–279) whitespace-tokenizes each segment, consumes env-var
    prefixes, and only cares about segments whose first word is literally `metta`.
  - `classify` (lines 282–302) → `'allow' | 'block' | 'unknown'` against explicit lists.
- Ordering of exits in `main()`: background-Bash-from-fork rejection (lines 415–425) →
  offender scan with Tier-1/Tier-2 authorization (lines 438–510) → the `!offender`
  branch (lines 512–523) which performs deferred Tier-2 re-prime writes and acceptance
  audit logs, then `exit(0)` → tier-specific block messages (lines 531–585).
  Important invariant documented at lines 513–517: **a blocked command never rewrites a
  credential token** — re-primes happen only after every invocation is authorized.
- Audit logging via `appendAuditLog` (lines 383–403) appends JSON lines to
  `<cwd>/.metta/logs/guard-bypass.log`, swallowing all I/O errors.
- Residual gaps are documented in-file (lines 133–152): wrappers (`env`, `command`,
  `sh -c`), command substitution, subshells, brace groups, backslash-escaped quotes.
  The stated defense-in-depth posture: the text layer is heuristic; real security comes
  from the two-tier trust model plus the audit log.
- **No write-target analysis of any kind exists** — a redirection/`tee`/`cp` into the
  main checkout passes untouched today (intent.md, Problem defect 2).

### 1.2 Worktree topology resolution precedent (`.claude/hooks/metta-guard-edit.mjs`)

guard-edit already solves the "which checkout does this path belong to, and is there an
active change there" problem, target-anchored rather than cwd-anchored:

- `toPhysicalPath` (lines 30–45): symlink-resolves the nearest **existing** ancestor and
  re-appends the not-yet-created tail, so not-yet-existing write targets compare
  correctly against git's physical paths. Tolerant on failure.
- `resolveTargetRoot` (lines 54–73): `git rev-parse --show-toplevel` (via
  `promisify(execFile)`, 5 s timeout) from the target's nearest existing ancestor; falls
  back to physical `process.cwd()` on any failure.
- `deriveProbeRoot` (lines 83–95): pure path math — if the checkout root is exactly
  `<H>/.metta/worktrees/<name>`, probe the hosting checkout `H` instead, because H's
  `metta status` **aggregates worktree-hosted change state** (its answer is a strict
  superset of the worktree's own).
- Active-change probe (lines 121–139): `metta status --json` at the probe root, 5 s
  timeout, fail-open on any error; handles both `{change: "..."}` and
  `{changes: [...]}` response shapes.

### 1.3 Where the main-vs-worktree facts live

- `metta status --json` at the hosting checkout returns a top-level
  `worktree: "<absolute path>"` field for a worktree-hosted active change (verified
  empirically on this change: it reports
  `/home/utx0/Code/metta/.metta/worktrees/fix-guard-edit-worktree-write-friction-caused-cross-repo`).
  Backing field: `worktree: z.string().optional()` in
  `src/schemas/change-metadata.ts:117`; persisted in the change's `.metta.yaml`
  (line 45 of this change's own metadata).
- So one probe yields both facts the check needs: **worktree-hosted?** (worktree field
  present) and **the worktree root** (its value); the **main root** is the probe root
  itself.

### 1.4 Template mirror and install path

- Shipped counterpart: `src/templates/hooks/metta-guard-bash.mjs`, currently
  byte-identical to `.claude/hooks/metta-guard-bash.mjs` (verified via `diff`).
- `src/cli/commands/install.ts` (lines 30–41) copies every file in
  `src/templates/hooks/` into `<root>/.claude/hooks/` on install, so mirroring the
  change into the template satisfies the "consumer installs receive it" requirement
  with no new mechanism.

### 1.5 Existing test harness for hooks

- `tests/metta-guard-bash.test.ts` (1210 lines): black-box integration tests that
  `spawnSync('node', [hookPath])` with a JSON stdin payload and assert exit code +
  stderr, run against **both** the source template and the deployed hook
  (`HOOK_SOURCES`, lines 12–15), plus a byte-identity test (line 1206:
  `'source and deployed hook are byte-identical'`). All runs default to a throwaway
  sandbox cwd so audit-log writes never pollute the repo (lines 22–29).
- `tests/metta-guard-edit.test.ts` (585 lines) establishes the pattern for testing
  hooks that probe `metta status --json`: a **PATH shim** — a stub `metta` script
  prepended to PATH that emits a canned JSON status (lines ~219–231), plus a
  delegating-shim real-CLI topology suite (lines 371+). There is no in-process unit
  testing of hook internals anywhere — the hooks export nothing and run `main()` on
  import, so the black-box spawn harness is the established (and only) pattern.

## 2. Options

### 2.1 Write-target extraction

**Option E1 — regex/token heuristic layered on the existing quote-mask utilities
(recommended).**
Reuse `splitCommandSegments` + `computeQuoteMask`. Per segment:

- **Redirections**: scan for unquoted `>` characters. Classify the operator run:
  `>`/`>>` (optionally with a leading fd digit, e.g. `2>`) capture the next word as a
  target; `>&N`, `<`, `<<`/`<<<` and process substitution `>(...)` are skipped or
  trigger fail-open. Note `|` and `&` are chain separators (line 129), so a pipe
  boundary already isolates each simple command into its own segment, and `>&` runs get
  split — an `&` inside `2>&1` produces a segment boundary today, which is harmless for
  this purpose (the tail segment `1` extracts nothing).
- **Heredocs need no dedicated logic**: a heredoc feeds stdin; the file write in
  `cat <<EOF > /path` is the `>` redirection, which the redirection rule already
  captures. The zeus incident's heredoc writes were exactly this shape.
- **Command-word rules**: if a segment's first non-env-prefix word is `tee` → all
  non-flag arguments are targets; `cp`/`mv` → last non-flag argument (plus the `-t
  <dir>` form); optionally `install` (last non-flag arg) and `dd` (`of=` value) as
  cheap extras beyond the spec's required set.
- **Confidence gate** (this is where fail-open lives): a candidate word is *confident*
  only if, after simple quote-stripping (`stripQuoteChars`, line 180), it is a plain
  absolute path — starts with `/`, contains no `$`, no backtick, no `\`, no glob
  metacharacters, and the segment's quoting parsed (`unterminated === false`).
  Everything else — relative paths (out of scope per spec), `$VAR` targets, `$(...)`,
  `~user`, exotic quoting — is simply **not extracted**, which is the allow outcome.
  Optionally expand a leading `~/` via `os.homedir()` (deterministic in practice);
  otherwise treat it as non-absolute → allowed (documented residual).

Pros: ~80–120 lines; same idiom, same documented limitations, same fail-open direction
as the rest of the file; trivially matrix-testable. Cons: enumerated commands only;
`sh -c '...'`, `python -c`, `xargs`, `rsync`, `git -C <main> apply/checkout` all pass —
but every one of those is already named as accepted residual in intent.md Out of Scope
and the spec's fail-open requirement.

**Option E2 — small shell-word parser.**
A real word-splitting state machine (backslash escapes, quote concatenation, operator
tokens per POSIX shell grammar), then walk the word/operator stream. Pros: correctly
handles `>"$f"` vs `">f"`, glued operators, escaped quotes; fewer misparses. Cons:
~300+ lines of new grammar code in a hook whose header explicitly declares a bash
parser out of scope (lines 148–150 and intent.md Out of Scope); the extra correctness
mostly rescues cases the spec says must fail open anyway; higher review and regression
surface inside a security-relevant file. Not justified by the threat model — the
adversary here is a confused-but-honest executor, not an attacker crafting evasions.

**Option E3 — third-party parser (e.g. a bash AST npm package).**
Rejected outright: hooks are standalone dependency-free `.mjs` files copied verbatim
into consumer projects by `install.ts`; they cannot carry npm dependencies.

### 2.2 Topology resolution (main root, worktree root, "is this change worktree-hosted")

**Option T1 — target-anchored probe, guard-edit pattern (recommended).**
Only runs when extraction produced ≥1 confident absolute target. For each target:
1. `toPhysicalPath(target)` (port of guard-edit lines 30–45).
2. `resolveTargetRoot` → `git rev-parse --show-toplevel` from the nearest existing
   ancestor (port of guard-edit lines 54–73); failure → skip target (fail open).
3. `deriveProbeRoot` (port of lines 83–95) → hosting root `H`.
4. One `metta status --json` probe at `H` (cached across targets within the event,
   5 s timeout, fail open). If the response carries a string `worktree` field `W`:
   block iff `target` is inside `H`, NOT inside `W`, and NOT inside the shared-path
   allow set (below). No `worktree` field / no active change / probe failure → allow.

Pros: correctness is independent of `event.cwd` — it works whether the executor's bash
cwd is the worktree, the main checkout (the zeus incident shape: session cwd = H,
absolute paths into H), or anywhere else; it naturally exempts `/tmp`, scratchpads, and
unrelated repos (their `git rev-parse` roots have no worktree-hosted metta change);
and it reuses a topology algorithm that has survived three rounds of worktree-guard
hardening (see `spec/archive/2026-08-08-fix-metta-guard-edit-worktree-blind`,
`2026-08-18-fix-metta-guard-edit-still-false-positive-blocks-subagent`). Cons: adds
subprocess spawns (`git` + `metta`) to the hook — but only on the rare Bash call that
writes to a confident absolute path, never on the hot path (see 4.3).

**Option T2 — cwd-anchored pure path math, no subprocess.**
Derive topology from `event.cwd` alone: if physical cwd sits under
`<H>/.metta/worktrees/<name>`, that gives `W` and `H` for free. Pros: zero latency.
Cons: **misses the incident case** — in the zeus contamination the Bash cwd was the
session cwd (the main checkout), not the worktree, so cwd-anchoring alone would never
have engaged. Covering cwd = H without a probe means scanning
`<H>/.metta/worktrees/*/spec/changes/*/.metta.yaml` and regex-parsing YAML for
`status: active` in a dependency-free hook — brittle, duplicates state-store semantics,
and breaks silently if metadata layout shifts. Rejected as the sole mechanism; the
`deriveProbeRoot` path math is still used inside T1 step 3.

**Option T3 — direct state-file read instead of `metta status --json`.**
Same YAML-regex fragility as T2, and it bypasses the aggregation logic
(`H`'s status being a strict superset of the worktree's own — guard-edit lines 76–82)
that already handles both the canonical and inverted-hosting topologies. Rejected;
the CLI probe is the stable public contract and the precedented one.

### 2.3 Shared-path allow set

Targets under `H` that must never block:
- Anything under `W` itself (spec requirement: worktree-internal writes pass).
- Anything under `<H>/.metta/` — shared operational state: `scratch/` (skill session
  material, executor temp files), `logs/`, `locks/`, `gates/`, and — critically —
  `worktrees/` itself, which makes the `W`-inside-`H` case structurally safe even if
  `W` comparison had an edge. Sibling worktrees are thereby also allowed; intent.md Out
  of Scope explicitly limits the check to the main-checkout-vs-worktree relationship,
  so cross-worktree writes are an accepted non-goal.
- Everything outside `H` (other repos, `/tmp`, scratchpad) is allowed by construction —
  it never matches the "inside H" predicate.

Blocked set is therefore: confident absolute target physically inside `H`, outside
`<H>/.metta/`, while `H` hosts a worktree-hosted active change. That precisely covers
`/home/utx0/Code/zeus/src/config.rs` from the incident and precisely excludes every
legitimate write class observed in the codebase's own workflows.

## 3. Proposed design (recommended)

E1 + T1 + the 2.3 allow set, integrated as follows:

1. **New pure function** `extractWriteTargets(command)` → `string[]` of confident
   absolute candidate targets, built on `splitCommandSegments`/`computeQuoteMask`.
   Placed in the hook file alongside the existing tokenizer, with a header comment
   mirroring the existing KNOWN LIMITATION block (lines 133–152) enumerating the
   fail-open set.
2. **New async function** `checkWriteTargets(event, targets)` implementing T1
   (physicalize → git toplevel → deriveProbeRoot → single cached status probe →
   classify). Returns `null` (allow) or `{ target, mainRoot, worktreeRoot }` (block).
3. **Placement in `main()`**: immediately after the background-Bash rejection
   (line 425) and **before** the offender scan. Rationale: the `!offender` branch
   (lines 512–523) performs Tier-2 re-prime writes; a command blocked for
   write-target reasons must not act as a credential keepalive, mirroring the
   existing "blocked command leaves every token file byte-untouched" invariant. Fast
   path: `extractWriteTargets` returns `[]` for the overwhelming majority of commands
   → fall through with zero subprocess cost, preserving today's latency profile.
4. **Block behavior**: `appendAuditLog(event, 'block', {sub:null,third:null},
   'worktree-write-target', null, { target, mainRoot, worktreeRoot })`; stderr names
   the offending path and the expected change_root prefix (spec requirement), e.g.
   "write target `<target>` resolves into the main checkout `<H>` while change
   `<slug>` is worktree-hosted; write under `<W>` instead"; `exit(2)`.
5. **Fail-open wrapper**: the whole check runs inside try/catch → allow. Consistent
   with guard-edit's tolerant philosophy and the spec's fail-open requirement. Node
   `child_process` imports are added (`promisify(execFile)`), making `main()`'s new
   section async — `main()` is already `async`.
6. **Template mirror**: apply identical bytes to
   `src/templates/hooks/metta-guard-bash.mjs`; the existing byte-identity test
   (tests/metta-guard-bash.test.ts:1206) enforces the mirror forever.
7. **Tests** (extend `tests/metta-guard-bash.test.ts`, same black-box harness):
   - Fixture: temp dir with `main/` (git init) + `main/.metta/worktrees/<name>/`
     (git worktree or plain dir + PATH-shimmed `metta` emitting
     `{"change":"<name>","worktree":"<abs worktree path>"}` — the guard-edit shim
     pattern at tests/metta-guard-edit.test.ts:219–231 transplants directly; a shim
     avoids needing a real `metta` install and pins probe output deterministically).
   - Blocked matrix: `echo x > <main>/src/f`, `cat <<EOF > <main>/f`,
     `printf x | tee <main>/f`, `cp a <main>/f`, `mv a <main>/f` → exit 2, stderr
     contains the target and the worktree prefix.
   - Allowed matrix: same forms targeting `<worktree>/...`; relative targets;
     `> /tmp/x`; `$VAR` / `$(...)` targets (fail open); non-write commands
     (`git status`, `npm test`); shim reporting no active change; shim reporting an
     active change **without** a `worktree` field (main-hosted change); `metta`
     absent from PATH (probe fail-open).
   - Regression: the full pre-existing suite must pass unmodified (spec requirement
     "behavior-preserving for every existing guard-bash path") — placement before the
     offender scan cannot change any metta-CLI verdict because the check exits only on
     a confident main-checkout write, never on a metta invocation as such; the one
     interaction to pin with a test is a compound command combining an authorized
     Tier-2 metta call with a blocked write (assert exit 2 **and** token file
     unchanged).
   - Unit-style testing of `extractWriteTargets` in isolation is possible only by
     adding an export + import-guard (`if (import.meta.url === pathToFileURL(
     process.argv[1]).href) main()`); this deviates from how every other hook is
     built and adds a hazard (an import that forgets the guard re-runs `main()`).
     Given the harness already exercises pure classification exhaustively through the
     process boundary in <10 ms per spawn, stay with black-box; note this as an
     accepted deviation from in-process unit style, matching all prior hook changes.

## 4. Edge cases

| Case | Outcome under proposed design |
|---|---|
| `cat <<EOF > /main/src/f.rs` (zeus shape) | Blocked — `>` target extraction; heredoc itself irrelevant |
| `echo x >> /main/f` / `2> /main/f` | Blocked — fd-prefixed and append forms handled |
| `2>&1`, `>&2` | No target extracted (chain-split on `&` yields no confident path) — allowed |
| `echo x > "$OUT"` / `> $(mktemp)` | Not confident — fail open (spec scenario) |
| `echo x > ./f` or `> ../f` with cwd = main | Relative — out of scope per spec, allowed; documented residual |
| `bash -c 'echo x > /main/f'`, `python -c`, `xargs`, `rsync`, `git -C /main checkout` | Invisible to extraction — fail open, named residual (intent Out of Scope) |
| `tee -a /main/f` | Blocked — `tee` non-flag args |
| `cp -r src/ /main/dst` | Blocked — last-non-flag-arg destination |
| `cp --target-directory=/main/d a b` / `-t /main/d` | Handle both `-t` forms or fail open on `--target-directory=` — either satisfies spec; recommend handling both, it is one regex |
| Write to `<main>/.metta/scratch/...` | Allowed — shared-path set |
| Write into a **sibling** worktree | Allowed (under `<H>/.metta/`) — accepted non-goal |
| Target file/dirs don't exist yet | Handled — `toPhysicalPath` nearest-existing-ancestor walk |
| Symlinked session paths | Handled — both sides compared physical (guard-edit lines 154–163 precedent) |
| Main-hosted active change (no `worktree` field) | Check inert (spec scenario "no worktree-hosted active change") |
| Non-metta repo / no metta on PATH / status timeout | Probe fails → allow (tolerant philosophy) |
| Multiple absolute targets in one compound command | Each checked; first blocked one reported |
| `>` inside quotes (`echo "a > b"`) | Quote mask excludes it — no extraction |
| Unterminated quote in command | Quoting unparseable → extraction not confident → allow (note: this is the opposite direction from the metta-invocation tokenizer's fail-**closed** fallback at line 225 — correct here, because for write targets the spec mandates fail-open, and an unterminated quote is a bash syntax error that never executes anyway) |

## 5. Risks and tradeoffs

- **False positives** are the primary product risk (an over-blocking guard trains
  agents/users to disable it). Mitigations already in the design: absolute-plain-text
  targets only, `.metta/` shared allow, worktree-hosted-context gating, probe
  fail-open, try/catch fail-open. Highest-residual-risk legitimate write: an
  orchestrator intentionally writing a file at the main checkout root while a worktree
  change is active (e.g. editing `spec/issues/*.md` at H via bash). That is exactly
  the contamination class being banned, and Edit/Write-tool writes (the sanctioned
  path, with guard-edit's own allow-list for `spec/issues/`) are untouched — so this
  is a feature, not a bug, but worth naming in the stderr text ("use the Edit tool or
  work under the worktree").
- **Latency**: zero added cost for commands with no confident absolute write target
  (pure string ops). For the rare candidate command: 1 `git rev-parse` (+~10 ms) +
  1 `metta status --json` (Node CLI startup, ~200–600 ms) — the same cost guard-edit
  already pays on **every** Edit/Write, here paid only on absolute-path bash writes.
  Acceptable; no caching across events needed.
- **False negatives**: the enumerated fail-open set (interpreters, wrappers,
  substitution, relative paths with a main cwd). Accepted by spec; the STOP-and-report
  template rules (layer 1) and the tree-clean detection (layer 3) exist precisely to
  cover this residual.
- **Divergence risk between the two hook copies**: eliminated by the existing
  byte-identity test.
- **Duplicated topology code**: `toPhysicalPath`/`resolveTargetRoot`/`deriveProbeRoot`
  get ported from guard-edit into guard-bash (~60 lines). Hooks are standalone by
  design (no shared imports — they are copied individually into consumer projects), so
  duplication is the established cost; a shared `.claude/hooks/lib.mjs` would change
  the install contract in `install.ts` and is not warranted for one consumer. Keep the
  ports comment-annotated as "port of metta-guard-edit.mjs — keep in sync".
- **Ordering interaction with Tier-2 re-prime**: placing the check before the offender
  scan preserves the blocked-commands-never-reprime invariant; pin with the compound
  command test in 3.7.

## 6. Recommendation

**Option E1 + T1**: a regex/token write-target extractor built on the hook's existing
quote-mask/segmentation utilities, gated by a confidence predicate (absolute,
plain-text targets only), with topology resolved target-anchored via the guard-edit
pattern (physicalize → `git rev-parse --show-toplevel` → `deriveProbeRoot` → one
cached `metta status --json` probe reading the `worktree` field), a shared-path allow
set of `{W, <H>/.metta/}`, placement before the offender scan, whole-check
try/catch fail-open, byte-identical template mirror, and black-box spawn tests with a
PATH-shimmed `metta` following the guard-edit test fixture pattern.

This is the smallest design that (a) would have blocked both zeus incident writes,
(b) satisfies every ADDED requirement in spec.md for the guard-bash layer, (c) reuses
two battle-tested code idioms already living in the two hooks, and (d) keeps the
zero-subprocess fast path for ordinary bash commands. A shell-word parser (E2) buys
correctness only in the region the spec mandates fail-open; cwd-anchored resolution
(T2) misses the actual incident shape. No external grounding was required: all claims
rest on stable POSIX shell semantics and direct inspection of the repo (file:line
citations above; `metta status --json` output and template diffs verified empirically
on 2026-08-18).
