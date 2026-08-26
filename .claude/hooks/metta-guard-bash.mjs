#!/usr/bin/env node
// PreToolUse Bash hook: block direct metta state-mutating CLI calls from AI orchestrator
// sessions. Authorization follows a two-tier trust model:
// - Tier 1 (fork-tier): `propose`, `quick`, `auto`, `ship`, `issue`, `fix-issue` are
//   authorized by `event.agent_type` — set by the Claude Code runtime when a forked
//   `metta-skill-host` subagent fires the tool. Not forgeable from command text.
// - Tier 2 (session-tier): main-session lifecycle subcommands (`complete`, `finalize`,
//   `refresh`, `import`, `init`, `fix-gap`, `verify`, plus the scoped two-word forms
//   `backlog add/done/promote/migrate`, `milestone create`, and `changes abandon`) are
//   authorized by per-skill session
//   credentials at `.metta/scratch/skill-session/<slug>.token`, each minted by
//   `.claude/hooks/metta-session-mint.mjs` when the matching Tier-2 skill is invoked and
//   rotated on a sliding TTL. Freshness is judged in two bands: a token is FRESH within
//   its ttlMs, and RE-PRIMABLE when its `sessionId` (stamped at mint time from the
//   runtime-supplied `event.session_id` — never derived from command text) matches this
//   event's `session_id` and the token is within ttlMs + GRACE_MS. A call is authorized
//   when ANY structurally valid token in either band covers the subcommand — so one
//   skill's credential never blocks another active skill's. An acceptance authorized
//   ONLY via the re-prime band causes this guard to rewrite that token (new random
//   token value, mintedAt = now; best-effort atomic temp+rename) and is audit-logged as
//   `session-credential-reprimed`; fresh-band acceptances keep
//   `session-credential-verified`. `credential-expired` therefore means genuinely dead:
//   no fresh AND no re-primable token. A missing or non-string `event.session_id`
//   disables the re-prime band entirely (fail-closed degradation to fresh-band-only),
//   as do old-format tokens without a `sessionId`. Not derivable from reading any
//   skill file.
// Emergency bypass (humans/CI): disable this hook in .claude/settings.local.json.

import { readFileSync, appendFileSync, mkdirSync, readdirSync, writeFileSync, renameSync, unlinkSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, basename, isAbsolute, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Explicit ALLOW list: known safe read-only single-subcommand forms.
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'instructions', 'progress', 'doctor',
  'next', // read-only routing query (`metta next --json`); first Bash call of the metta-next skill body
  'iteration', // counter-only instrumentation; skills call it during fan-out. Read-safe-ish; no state-mutating side effects beyond a per-change counter.
  'model-escalation', // audit-only instrumentation; skills call it during the execute/verify fix loop. Appends a per-change escalation record; no broader state-mutating side effects than the iteration counter has.
  'tokens', // append-only usage instrumentation; recording is hook-driven — a SubagentStop hook runs `metta tokens record` with harness-measured usage. Kept allowed for the manual `--source prose` fallback when the hook is unavailable. Appends a per-change token_usage record; no broader state-mutating side effects than model-escalation has.
  'install', // intentional pass-through for human/CI-driven install (no matching skill yet)
]);

// Explicit ALLOW list for two-word read-only forms.
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
const ALLOWED_TWO_WORD = new Map([
  ['issues', new Set(['list'])],
  ['gate', new Set(['list'])],
  ['changes', new Set(['list'])],
  ['backlog', new Set(['list', 'show'])],
  // `gaps list` / `gaps show` are pure queries over spec/gaps/ with no state-mutating
  // side effects, matching the issues/changes/backlog read-only pattern above.
  // `gaps remove` is deliberately NOT listed here — it mutates state and stays fail-closed.
  ['gaps', new Set(['list', 'show'])],
  // `milestone list` / `milestone show` are pure queries over spec/milestones/ with no
  // state-mutating side effects. Bare `metta milestone` is deliberately NOT in
  // ALLOWED_BARE — it stays fail-closed as unknown.
  ['milestone', new Set(['list', 'show'])],
  // `release status` is a pure read-only report (version, pending changes, recommended
  // bump); the mutating `release cut` stays Tier-2 blocked below.
  ['release', new Set(['status'])],
]);

// Explicit BLOCK list: state-mutating single-subcommand forms.
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
const BLOCKED_SUBCOMMANDS = new Set([
  'propose', 'quick', 'auto', 'complete', 'finalize', 'ship',
  'issue', 'fix-issue', 'fix-gap', 'refresh', 'import', 'init',
  // `verify` runs gates (executes commands) — not read-only, so it is credential-gated
  // as Tier 2 rather than allow-listed.
  'verify',
]);

// Explicit BLOCK list for two-word mutating forms.
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
const BLOCKED_TWO_WORD = new Map([
  ['backlog', new Set(['add', 'done', 'promote', 'migrate'])],
  ['changes', new Set(['abandon'])],
  // `milestone create`/`close`/`update` mutate state (write spec/milestones/<slug>.md) —
  // Tier-2 scope keys 'milestone:create', 'milestone:close', 'milestone:update', minted
  // only by the metta-backlog skill.
  ['milestone', new Set(['create', 'close', 'update'])],
  ['roadmap', new Set(['add', 'reorder', 'next', 'remove'])],
  // `release cut` mutates state (version bump, tag, release commit) — Tier-2 scope
  // key 'release:cut', minted only by the metta-release skill.
  ['release', new Set(['cut'])],
]);

// Explicit ALLOW list for bare (no-third-word) read-only command groups: the
// bare form (optionally with flags, e.g. `metta roadmap --json`) is a read-only
// status view, while its two-word mutating forms stay Tier-2 blocked above.
// `roadmap <any-unknown-word>` / `release <any-unknown-word>` / `backlog <any-unknown-word>`
// remain 'unknown' → fail-closed.
// Bare `metta release` defaults to the read-only status view (roadmap precedent).
// Bare `metta backlog` defaults to the read-only list view; its mutating two-word
// forms (`add`/`done`/`promote`/`migrate`) stay Tier-2 blocked above.
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
const ALLOWED_BARE = new Set(['roadmap', 'release', 'backlog']);

// Subcommands that require a trusted agent_type (caller identity set by the Claude Code
// runtime when a forked metta-* subagent fires the tool). Verified caller identity is the
// sole Tier-1 check — inline command text never contributes authorization.
const SKILL_ENFORCED_SUBCOMMANDS = new Set([
  'issue', 'fix-issue', 'propose', 'quick', 'auto', 'ship',
]);

// Mapping from enforced subcommand to the user-facing skill hint shown in rejection messages.
const SKILL_HINT_MAP = new Map([
  ['issue', '/metta-issue'],
  ['fix-issue', '/metta-fix-issues'],
  ['propose', '/metta-propose'],
  ['quick', '/metta-quick'],
  ['auto', '/metta-auto'],
  ['ship', '/metta-ship'],
]);

// Bounded horizon of the Tier-2 re-primable band (see header): a session-bound token
// stays re-primable until ttlMs + GRACE_MS after its last mint or re-prime.
// MUST equal GRACE_MS in metta-session-mint.mjs — the guard's re-prime horizon and the
// mint hook's sibling-cleanup threshold are one policy; seam tests pin the equality.
const GRACE_MS = 3_600_000;

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Chain-separator segmentation: `;`, `|`, `&`, `&&`, `||`, and newlines are all bash command
// separators. Splitting the command into segments on these characters BEFORE whitespace
// tokenization (rather than only recognizing a separator that is already its own
// whitespace-delimited token) is required so a separator glued directly onto a preceding
// word — e.g. `--json;metta backlog add x`, where bash still treats `;` as a boundary even
// though there is no space around it — still produces a segment boundary. Any run of
// chain-separator characters, or a `\n`/`\r\n`, counts as one boundary; we only care where
// segments start and end, not which separator produced the split.
const CHAIN_SEPARATOR_RE = /[;|&]+|\r?\n/;

// KNOWN LIMITATION (wrapper prefixes and shell indirection): textual guarding can only ever
// see the literal words bash executes. Wrappers such as `command metta finalize`,
// `env metta finalize`, `\metta finalize`, `xargs`, `sh -c '...'`, or a wrapper script that
// itself execs metta are invisible to this tokenizer. The same is true of shell-level
// indirection that produces the `metta` invocation dynamically rather than as literal text in
// the scanned command string: command substitution (`$(...)`), backticks, subshells
// (`(...)`), and process substitution (`<(...)`/`>(...)`). Brace groups (`{ ...; }`) run in
// the current shell rather than a subshell, but a segment starting with `{` is skipped by
// this tokenizer the same way, so `metta status;{ metta finalize; }` also evades textual
// detection. Quoting-based hiding is also out of scope beyond the specific `--` and
// chain-separator cases this file does handle: an env-var prefix whose value itself contains
// a space via quoting (e.g. `FOO="a b" metta ...`) or a quoted/split command name (e.g.
// `"metta"` or `me""tta`) is not recognized as an invocation. Backslash-escaped quotes
// (`\"`) are another gap in the same family: computeQuoteMask() treats every `"`/`'` as a
// real quote toggle rather than understanding that a backslash-escaped quote is literal text,
// not a quote boundary — so a glued separator bracketed by a `\"` pair on each side is not
// split the way bash itself would split it. There is no bounded, enumerable list of these
// forms to special-case, and a full
// bash-grammar parser is explicitly out of scope (see this change's intent.md). This is an
// accepted limitation of the text layer: defense in depth comes from the two-tier trust model
// (verified fork caller identity / minted session credentials) and the audit log below, not
// from trying to mechanically detect every possible indirection.

// Track quote state (single- vs double-quoted vs none) across a raw string so `--` detection
// can distinguish Commander's bare operand terminator from a `--` that only appears as
// literal text inside a quoted argument (e.g. an issue description containing " -- " as
// prose). This is a light heuristic, not a shell-grammar parser — it does not understand
// backslash escapes, nested substitutions, or ANSI-C quoting. `unterminated` is true when a
// quote opened in `text` never closes; callers use that to fall back to the previous
// quote-unaware (fail-closed) check rather than guess at ambiguous input.
function computeQuoteMask(text) {
  const quoted = new Array(text.length).fill(false);
  let openQuote = null; // null | "'" | '"'
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (openQuote === null) {
      if (ch === "'" || ch === '"') openQuote = ch;
      continue;
    }
    quoted[i] = true;
    if (ch === openQuote) openQuote = null;
  }
  return { quoted, unterminated: openQuote !== null };
}

// Remove single- and double-quote characters from a word, e.g. `"--"` -> `--`,
// `'--'` -> `--`, `""--` -> `--`. This is bash quote REMOVAL for the simple
// single/double-quote case only — it does not understand backslash escapes or ANSI-C
// quoting, matching the same limitation documented on computeQuoteMask() above.
function stripQuoteChars(word) {
  return word.replace(/['"]/g, '');
}

// True when `text` contains a `--` word that Commander would see as a live operand
// terminator — either a bare unquoted `--`, or a word whose quote-removed form is exactly
// `--` (e.g. `"--"`, `'--'`, `""--`) — Commander's own quote removal (performed by bash
// before argv ever reaches Commander) collapses all of these to the same operand
// terminator. A `--` is only a candidate when the WORD is self-contained with respect to
// the surrounding quoting context — i.e. quoting neither carries in from a preceding word
// nor bleeds out into a following one — so a `--` that is a proper substring of a longer
// quoted, multi-word argument (e.g. `"hello -- world"`, where `--` is one word among three
// inside a single quoted span) is correctly left ALLOWED as literal text. Fails closed
// (returns true, matching the previous quote-unaware behavior) when the quoting in `text`
// cannot be confidently parsed, e.g. an unterminated quote: an unparseable input never gets
// the benefit of the doubt.
function hasUnquotedDoubleDash(text) {
  const { quoted, unterminated } = computeQuoteMask(text);
  const words = Array.from(text.matchAll(/\S+/g));
  if (unterminated) {
    return words.some((m) => stripQuoteChars(m[0]) === '--');
  }
  return words.some((m) => {
    const start = m.index;
    const end = start + m[0].length;
    const selfContained = !quoted[start] && (end >= quoted.length || !quoted[end]);
    return selfContained && stripQuoteChars(m[0]) === '--';
  });
}

// Split `command` into chain-separator-delimited segments, splitting ONLY at separator runs
// that are entirely unquoted — a separator character sitting inside a single- or
// double-quoted span (e.g. the `;` in `FOO=';' metta finalize`) is literal text, not a
// boundary, and slicing there would cut a quoted token in half and produce a stray leading
// quote character in the next segment (which then fails the `metta`-word check and hides the
// invocation entirely — see this file's F1 regression fix). The quote mask is computed once
// over the WHOLE command string so quoting state correctly carries across segment
// boundaries. When the whole command has an unterminated quote, quoting state cannot be
// trusted for the rest of the string, so this falls back to the previous quote-unaware split
// (every separator run is a boundary) — over-splitting only risks a false phantom block, it
// never hides a bash-executable invocation (an unterminated quote is itself a bash syntax
// error, so input that reaches this fallback never actually executes), matching the
// fail-closed direction used throughout this file.
function splitCommandSegments(command) {
  const { quoted, unterminated } = computeQuoteMask(command);
  if (unterminated) return command.split(CHAIN_SEPARATOR_RE);
  const segments = [];
  let segStart = 0;
  const re = new RegExp(CHAIN_SEPARATOR_RE.source, 'g');
  let match;
  while ((match = re.exec(command)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const allUnquoted = !quoted.slice(start, end).some(Boolean);
    if (allUnquoted) {
      segments.push(command.slice(segStart, start));
      segStart = end;
    }
    // A partially/fully quoted separator run is literal text — leave it in the current
    // segment and keep scanning past it for the next candidate boundary.
  }
  segments.push(command.slice(segStart));
  return segments;
}

// ---------------------------------------------------------------------------
// Worktree write-target check (layer 2 of the cross-checkout write defense).
// Blocks a bash-mediated file write whose confident absolute target resolves
// into the MAIN checkout while that checkout's active change is worktree-hosted.
//
// KNOWN LIMITATION (write-target extraction is heuristic and FAIL-OPEN): this
// extractor only sees literal, plainly-quoted absolute paths in the specific
// write forms enumerated below (`>`/`>>` redirections including fd-prefixed
// `N>`/`N>>`, `tee` non-flag arguments, `cp`/`mv` destinations including the
// `-t <dir>` and `--target-directory=<dir>` forms). Everything else is
// deliberately NOT extracted and therefore ALLOWED: relative targets, `$VAR`
// and `${...}` expansions, command substitution (`$(...)`/backticks), `~`
// expansion, glob/brace targets, backslash escapes, unterminated quoting (a
// bash syntax error that never executes anyway), interpreter/wrapper
// indirection (`sh -c '...'`, `python -c`, `xargs`, `rsync`, `dd of=`,
// `install`, `git -C <main> checkout/apply`), and process substitution
// (`>(...)`). Additional documented residuals:
// - `>|` noclobber redirects fail OPEN: the `|` is treated as a chain
//   separator, so the target lands in a fresh segment carrying no operator
//   and is never extracted.
// - Source-side mutations are out of scope by design: `mv <main-file>
//   elsewhere`, `rm <main-file>`, `sed -i <main-file>`, `curl -o` and
//   friends mutate or remove main-checkout files without appearing as a
//   write DESTINATION here — that residual is covered by layer 3 (the
//   main-checkout tree-clean detection), not by this check.
// - Multi-change probe payloads fail OPEN: a `metta status --json` response
//   shaped `{changes:[...]}` (no top-level string `worktree` field) yields a
//   null probe context, so targets under that checkout are allowed.
// - Escaped `>` operators over-block: bash treats `\>` as a literal `>`
//   character, but this extractor still sees the `>` and extracts the next
//   word as a target — for the `>` family the error direction is a false
//   block. That claim does NOT generalize to the heredoc operator: an
//   escaped `\<<` (bash: literal `<` followed by a plain `<` input
//   redirect — no heredoc at all) is still parsed by stripHeredocBodies()
//   as a heredoc operator, queuing a phantom terminator that swallows every
//   subsequent line — fail OPEN, the opposite direction.
// - Heredoc BODY lines are NOT scanned: stripHeredocBodies() below drops the
//   lines between a `<<`/`<<-` WORD operator and its terminator line before
//   extraction, so prose inside a heredoc mentioning `> /abs/path` never
//   produces a target (a redirect on the heredoc COMMAND line itself is
//   still extracted). The stripper uses per-line quote masks — a multi-line
//   quoted string containing `<<` can therefore over-strip subsequent lines,
//   which errs fail-open, consistent with this extractor's direction.
// - Arithmetic left-shift residual: a pure-numeric RHS is refused as a
//   heredoc terminator (`$((1<<2))`, `(( n = 1 << 4 ))` queue nothing), but
//   an arithmetic `<<` with a NON-numeric RHS (e.g. `$((x<<y))`) is still
//   misparsed as a heredoc operator — the phantom terminator swallows every
//   subsequent line, fail OPEN.
// NOTE the fail direction is deliberately OPPOSITE to the
// metta-invocation tokenizer in this file: unparseable input fails CLOSED for
// metta CLI classification but fails OPEN here — for write targets the spec
// mandates fail-open, and the residual is covered by the executor shell-write
// path-discipline rules (layer 1) and the main-checkout tree-clean detection
// (layer 3).
// ---------------------------------------------------------------------------

// Timeout-DoS hardening (review F2): a command padded with many absolute
// redirect targets must never push this hook past the harness per-hook
// timeout — a killed hook produces no block AND no audit entry, silently
// defeating the fail-closed metta-invocation scan that runs after this check.
// Three bounds keep the worst case flat: targets are DEDUPED, capped at
// MAX_WRITE_TARGET_CHECKS (targets beyond the cap are dropped — explicit
// fail-open), and the whole checkWriteTargets pass runs under an internal
// wall-clock budget of WRITE_TARGET_BUDGET_MS — when exceeded, remaining
// targets are abandoned (explicit fail-open) and control falls through to the
// offender scan. resolveTargetRoot additionally caches its git answer per
// nearest-existing-ancestor directory, so N nonexistent paths under one
// ancestor cost one subprocess, not N.
const MAX_WRITE_TARGET_CHECKS = 16;
const WRITE_TARGET_BUDGET_MS = 2000;

// Drop heredoc BODY lines from `command` before write-target extraction (see
// the KNOWN LIMITATION header above). Tracks `<<`/`<<-` WORD operators
// (quoted, backslash-escaped, or bare WORDs all reduce to the same
// terminator, mirroring bash quote removal) on command lines, then skips
// every subsequent newline-delimited line up to and including the matching
// terminator line (leading tabs stripped for `<<-`). `<<<` here-strings are
// not heredocs and are skipped. Multiple heredocs on one command line queue
// their terminators in order of appearance, matching bash. An unterminated
// heredoc drops the rest of the command — fail open.
function stripHeredocBodies(command) {
  if (!command.includes('<<')) return command; // fast path: no heredoc syntax at all
  const lines = command.split('\n');
  const kept = [];
  const pending = []; // queued { term, stripTabs } in body order
  for (const rawLine of lines) {
    if (pending.length > 0) {
      // Inside a heredoc body: never scanned, only checked against the
      // current terminator.
      const bodyLine = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      const cmp = pending[0].stripTabs ? bodyLine.replace(/^\t+/, '') : bodyLine;
      if (cmp === pending[0].term) pending.shift();
      continue;
    }
    const { quoted } = computeQuoteMask(rawLine);
    for (let i = 0; i < rawLine.length - 1; i++) {
      if (rawLine[i] !== '<' || rawLine[i + 1] !== '<' || quoted[i]) continue;
      if (i > 0 && rawLine[i - 1] === '<') continue;      // tail of `<<<`
      if (rawLine[i + 2] === '<') { i += 2; continue; }    // `<<<` here-string
      let j = i + 2;
      let stripTabs = false;
      if (rawLine[j] === '-') { stripTabs = true; j++; }
      while (j < rawLine.length && /[ \t]/.test(rawLine[j])) j++;
      let word = '';
      while (j < rawLine.length && !/[\s<>|&;()]/.test(rawLine[j])) { word += rawLine[j]; j++; }
      const term = stripQuoteChars(word).replace(/\\/g, '');
      // A pure-numeric WORD is refused as a terminator (review round-2 F2):
      // in `$((1<<2))` or `(( n = 1 << 4 ))` the `<<` is bash's arithmetic
      // left-shift, not a heredoc operator, and queuing its numeric RHS as a
      // terminator would swallow every subsequent line (fail OPEN) — hiding a
      // genuine main-checkout redirect on a later line. Real heredoc
      // delimiters are essentially never bare digits; refusing one merely
      // over-scans that body (a possible false BLOCK — the safe direction).
      // Arithmetic `<<` with a NON-numeric RHS (e.g. `$((x<<y))`) remains
      // misparsed — see the KNOWN LIMITATION header above.
      if (term.length > 0 && !/^[0-9]+$/.test(term)) pending.push({ term, stripTabs });
      i = j - 1;
    }
    kept.push(rawLine);
  }
  return kept.join('\n');
}

// Pure. Returns confident absolute candidate write targets for `command`;
// returns [] for the overwhelming majority of commands (the zero-subprocess
// fast path). Built on the same splitCommandSegments/computeQuoteMask/
// stripQuoteChars utilities as the metta tokenizer above.
function extractWriteTargets(command) {
  const out = [];
  // Heredoc bodies are data, not command text — strip them first so a body
  // line mentioning `> /abs/path` never yields a target (review F3).
  for (const segment of splitCommandSegments(stripHeredocBodies(command))) {
    const { quoted, unterminated } = computeQuoteMask(segment);
    // Unterminated quoting: extraction is not confident -> fail OPEN (see the
    // KNOWN LIMITATION header above; deliberately opposite to the tokenizer's
    // fail-closed fallback).
    if (unterminated) continue;
    const consumed = new Array(segment.length).fill(false);
    const candidates = [];
    // --- Redirection scan: unquoted `>`/`>>` runs, incl. fd-prefixed `N>` ---
    // `>&` and `<`-family operators carry no plain file target; `>(` is
    // process substitution (fail open). `|`/`&` are chain separators, so
    // `2>&1` splits harmlessly — its tail segment extracts nothing.
    let i = 0;
    while (i < segment.length) {
      if (segment[i] !== '>' || quoted[i]) { i++; continue; }
      if (segment[i - 1] === '<') { i++; continue; } // `<>` open-read-write — skip
      let j = i + 1;
      if (segment[j] === '>') j++;                    // `>>` append form
      if (segment[j] === '&' || segment[j] === '(') { i = j + 1; continue; }
      // A leading digit run counts as an fd prefix (`2>`) only when it is the
      // whole word before the `>` (preceded by whitespace or segment start).
      let opStart = i;
      let k = i - 1;
      while (k >= 0 && /[0-9]/.test(segment[k]) && !quoted[k]) k--;
      if (k < 0 || /\s/.test(segment[k])) opStart = k + 1;
      while (j < segment.length && /\s/.test(segment[j]) && !quoted[j]) j++;
      const targetStart = j;
      // The target word runs while non-whitespace OR quoted (quoted spaces
      // are part of the word, e.g. > "/path with space/f").
      while (j < segment.length && (!/\s/.test(segment[j]) || quoted[j])) j++;
      for (let m = opStart; m < j; m++) consumed[m] = true;
      if (j > targetStart) candidates.push(segment.slice(targetStart, j));
      i = j;
    }
    // --- Command-word rules: tee / cp / mv (redirection spans excluded) ---
    const words = [];
    let cur = '';
    for (let n = 0; n < segment.length; n++) {
      if (consumed[n] || (/\s/.test(segment[n]) && !quoted[n])) {
        if (cur) { words.push(cur); cur = ''; }
        continue;
      }
      cur += segment[n];
    }
    if (cur) words.push(cur);
    let w = 0;
    while (w < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[w])) w++; // env-var prefixes
    const cmd = w < words.length ? stripQuoteChars(words[w]) : '';
    const args = words.slice(w + 1);
    if (cmd === 'tee') {
      for (const a of args) if (!a.startsWith('-')) candidates.push(a);
    } else if (cmd === 'cp' || cmd === 'mv') {
      let viaTargetDir = false;
      for (let a = 0; a < args.length; a++) {
        if (args[a] === '-t' && a + 1 < args.length) {
          candidates.push(args[a + 1]);
          viaTargetDir = true;
          a++;
        } else if (args[a].startsWith('--target-directory=')) {
          candidates.push(args[a].slice('--target-directory='.length));
          viaTargetDir = true;
        }
      }
      if (!viaTargetDir) {
        const nonFlags = args.filter((a) => !a.startsWith('-'));
        if (nonFlags.length >= 2) candidates.push(nonFlags[nonFlags.length - 1]);
      }
    }
    // --- Confidence gate (this is where fail-open lives): only a plain
    // absolute path counts — starts with `/`, and after quote removal contains
    // no `$`, backtick, backslash, or glob/brace/redirection metacharacters.
    // Relative paths, `$VAR`, `$(...)`, `~` -> not extracted -> allowed.
    for (const cand of candidates) {
      const plain = stripQuoteChars(cand);
      if (!plain.startsWith('/')) continue;
      if (/[$`\\*?[\]{}<>]/.test(plain)) continue;
      out.push(plain);
    }
  }
  return out;
}

// Convert an absolute path to its physical (symlink-resolved) form so it can
// be compared against `git rev-parse --show-toplevel`, which always reports
// physical paths. Write targets often don't exist yet, so realpath the nearest
// EXISTING ancestor and re-append the not-yet-created tail. Any realpath
// failure keeps the logical path (tolerant).
// Port of metta-guard-edit.mjs toPhysicalPath — keep in sync.
function toPhysicalPath(target) {
  let dir = target;
  const tail = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    tail.unshift(basename(dir));
    dir = parent;
  }
  try {
    dir = realpathSync(dir);
  } catch {
    // Tolerate: keep the logical prefix.
  }
  return tail.length > 0 ? join(dir, ...tail) : dir;
}

// Resolve the git top-level of the checkout containing `target` (an absolute
// physical path). Write targets often don't exist yet, so walk up to the
// nearest EXISTING ancestor before asking git.
// Port of metta-guard-edit.mjs resolveTargetRoot — keep in sync. Adapted for
// this check: any failure (git missing, target outside any repo) returns null
// so the caller SKIPS the target (fail open) instead of falling back to the
// session cwd — a target outside every git checkout can never be a
// main-checkout contamination. Results are cached per nearest-existing-
// ancestor directory (module-level cache IS per-event — the hook process is
// one event), and `/dev/` targets short-circuit to null without a subprocess:
// `> /dev/null` is ubiquitous and can never be a checkout write.
const targetRootCache = new Map();
async function resolveTargetRoot(target) {
  if (!target) return null;
  if (target === '/dev' || target.startsWith('/dev/')) return null; // cheap short-circuit
  let dir = dirname(target);
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (targetRootCache.has(dir)) return targetRootCache.get(dir);
  let root = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      timeout: 5000,
    });
    const top = stdout.trim();
    if (top) root = top;
  } catch {
    // Not a git checkout (or git unavailable) — fail open via null.
  }
  targetRootCache.set(dir, root);
  return root;
}

// Derive the root for the active-change probe. A metta-managed worktree's
// checkout root is exactly <H>/.metta/worktrees/<name>; in that case probe the
// hosting checkout H instead of the worktree. H's `metta status` aggregates
// worktree-hosted change state (its answer is a strict superset of the
// worktree's own). Any other checkout root is returned unchanged. Pure string
// path math — cannot throw.
// Port of metta-guard-edit.mjs deriveProbeRoot — keep in sync.
function deriveProbeRoot(checkoutRoot) {
  const worktreesDir = dirname(checkoutRoot);  // …/<H>/.metta/worktrees
  const mettaDir = dirname(worktreesDir);      // …/<H>/.metta
  const hostRoot = dirname(mettaDir);          // …/<H>
  if (
    basename(worktreesDir) === 'worktrees' &&
    basename(mettaDir) === '.metta' &&
    hostRoot !== mettaDir                      // defensive; unreachable in practice — the basename checks already exclude root-degenerate paths
  ) {
    return hostRoot;
  }
  return checkoutRoot;
}

// One cached `metta status --json` probe per event, keyed by probeRoot (the
// hook process is one event, so a module-level cache IS per-event). Returns
// { worktreeRoot } when a worktree-hosted change is active at probeRoot (the
// status payload carries a top-level string `worktree` field — the stable
// public contract, src/schemas/change-metadata.ts), else null: no active
// change, a main-hosted change (no `worktree` field), metta missing from
// PATH, timeout, or unparsable output all fail open via null.
const worktreeProbeCache = new Map();
async function probeWorktreeContext(probeRoot) {
  if (worktreeProbeCache.has(probeRoot)) return worktreeProbeCache.get(probeRoot);
  let ctx = null;
  try {
    const { stdout } = await execFileAsync('metta', ['status', '--json'], {
      cwd: probeRoot,
      timeout: 5000,
    });
    const status = JSON.parse(stdout);
    if (typeof status?.worktree === 'string' && status.worktree.length > 0) {
      ctx = { worktreeRoot: status.worktree };
    }
  } catch {
    ctx = null; // probe failure fails open
  }
  worktreeProbeCache.set(probeRoot, ctx);
  return ctx;
}

// True when `child` equals `root` or sits underneath it (both sides absolute
// physical paths).
function isInsidePath(child, root) {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Orchestrate the target-anchored topology check for each extracted target:
// physicalize -> git toplevel -> deriveProbeRoot -> one cached status probe ->
// classify. Block iff the physical target is inside probe root H AND NOT
// inside worktree W AND NOT inside <H>/.metta/ (the shared allow set — covers
// scratch/, logs/, gates/, and worktrees/ itself, so sibling-worktree writes
// are an accepted non-goal). Everything outside H (/tmp, scratchpads, other
// repos) never matches. Returns { hit, droppedTargets, budgetExhausted }:
// `hit` is null (allow) or the first block descriptor
// { target, mainRoot, worktreeRoot }; the other two fields report the
// explicit fail-open bounds below so the caller can audit-log them (review
// round-2 F4) — a silent drop is indistinguishable from "all targets checked
// clean" in forensics otherwise.
// DoS bounds (review F2, see the constants above): targets are deduped, only
// the first MAX_WRITE_TARGET_CHECKS unique targets are checked (the rest are
// dropped — fail open, count reported via droppedTargets), and the whole pass
// abandons remaining targets once WRITE_TARGET_BUDGET_MS of wall clock has
// elapsed (fail open, reported via budgetExhausted), falling through to the
// offender scan either way.
async function checkWriteTargets(targets) {
  const deadline = Date.now() + WRITE_TARGET_BUDGET_MS;
  const deduped = [...new Set(targets)];
  const unique = deduped.slice(0, MAX_WRITE_TARGET_CHECKS);
  const droppedTargets = deduped.length - unique.length;
  for (const target of unique) {
    if (Date.now() > deadline) {
      return { hit: null, droppedTargets, budgetExhausted: true }; // budget exhausted — abandon rest, fail open
    }
    const physical = toPhysicalPath(target);
    const checkoutRoot = await resolveTargetRoot(physical);
    if (checkoutRoot === null) continue; // not in any git checkout — fail open
    const probeRoot = deriveProbeRoot(checkoutRoot);
    const ctx = await probeWorktreeContext(probeRoot);
    if (ctx === null) continue; // no worktree-hosted active change — check inert
    const worktreeRoot = toPhysicalPath(ctx.worktreeRoot);
    if (
      isInsidePath(physical, probeRoot) &&
      !isInsidePath(physical, worktreeRoot) &&
      !isInsidePath(physical, join(probeRoot, '.metta'))
    ) {
      return { hit: { target, mainRoot: probeRoot, worktreeRoot }, droppedTargets, budgetExhausted: false };
    }
  }
  return { hit: null, droppedTargets, budgetExhausted: false };
}

function tokenize(command) {
  // Split into chain-separator-delimited segments first (see splitCommandSegments above),
  // then whitespace-tokenize each segment independently and look for a leading `metta`
  // invocation. Env-var prefixes (FOO=BAR ...) are consumed so the subcommand behind them is
  // still detected; inline command text (including any env-var prefix) never carries
  // authorization — Tier 1 trusts only the verified fork caller identity and Tier 2 trusts
  // only the minted session credential.
  // Return array of { sub, third, hasDoubleDash } where hasDoubleDash is true when an
  // unquoted bare `--` (or a word whose quote-removed form is `--`) token appears ANYWHERE in
  // the invocation's argument span (not just as the third token) — Commander's operand
  // terminator still dispatches what follows it as a subcommand, so classify() fails such
  // invocations closed.
  const results = [];
  const segments = splitCommandSegments(command);
  for (const segment of segments) {
    const tokens = Array.from(segment.matchAll(/\S+/g));
    let i = 0;
    // Consume env-var prefixes (FOO=BAR, ...)
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i][0])) i++;
    if (i >= tokens.length || tokens[i][0] !== 'metta') continue; // not an invocation in this segment
    const sub = tokens[i + 1]?.[0];
    const third = tokens[i + 2]?.[0];
    // A segment produced by splitCommandSegments contains exactly one command and its
    // arguments PROVIDED the whole command's quoting was parseable (splitCommandSegments
    // only splits on unquoted separator runs in that case) — so the argument span is simply
    // everything after the `metta` word, no further separator-skip walk needed. When the
    // whole command had an unterminated quote, splitCommandSegments falls back to splitting
    // on every separator run regardless of quoting, so this single-command-per-segment
    // guarantee does not hold in that fail-closed fallback path.
    const spanStart = tokens[i].index + tokens[i][0].length;
    const hasDoubleDash = hasUnquotedDoubleDash(segment.slice(spanStart));
    results.push({ sub, third, hasDoubleDash });
  }
  return results;
}

// Classification result: 'allow' | 'block' | 'unknown'
function classify(inv) {
  // Reject a `--` token ANYWHERE in the invocation's arguments — whether bare/unquoted or a
  // word whose quote-removed form is `--` (e.g. `"--"`, `'--'`, `""--`; see
  // hasUnquotedDoubleDash) — it is Commander's operand terminator, and what follows it still
  // dispatches as a subcommand (e.g. `metta backlog -- add x`, `metta backlog --json -- add x`,
  // and `metta backlog --json "--" add x` all run `backlog add`), so any such `--` fails
  // closed as unknown regardless of allow-list membership. This subsumes the earlier
  // third-token-only `--` rejection. A `--` that is a proper substring of a longer quoted,
  // multi-word argument (e.g. `"hello -- world"`) is literal text, not an operand terminator,
  // and stays allowed. No legitimate metta CLI call needs `--`.
  if (inv.hasDoubleDash) return 'unknown';
  if (!inv.sub) return 'allow'; // bare `metta` — harmless
  if (ALLOWED_SUBCOMMANDS.has(inv.sub)) return 'allow';
  const allowedTwo = ALLOWED_TWO_WORD.get(inv.sub);
  if (allowedTwo && inv.third && allowedTwo.has(inv.third)) return 'allow';
  if (ALLOWED_BARE.has(inv.sub) && (!inv.third || inv.third.startsWith('-'))) return 'allow';
  if (BLOCKED_SUBCOMMANDS.has(inv.sub)) return 'block';
  const blockedTwo = BLOCKED_TWO_WORD.get(inv.sub);
  if (blockedTwo && inv.third && blockedTwo.has(inv.third)) return 'block';
  return 'unknown';
}

// Caller-identity check: the Claude Code runtime populates event.agent_type when a tool call
// fires from a forked subagent. Orchestrator-driven Bash calls outside a skill fork have no
// agent_type or a non-metta value. This signal is not forgeable via the command string.
function isTrustedSkillCaller(event) {
  return typeof event.agent_type === 'string' && event.agent_type.startsWith('metta-');
}

// Structurally validate one Tier-2 session credential. Returns null on any shape
// mismatch (token must be a non-empty string, skill a string, subcommands an array of
// strings, mintedAt/ttlMs finite numbers) — so a valid-JSON-wrong-shape file fails
// closed as if absent.
function validateToken(tok) {
  if (typeof tok !== 'object' || tok === null || Array.isArray(tok)) return null;
  if (typeof tok.token !== 'string' || tok.token.length === 0) return null;
  if (typeof tok.skill !== 'string') return null;
  if (!Array.isArray(tok.subcommands) || !tok.subcommands.every((s) => typeof s === 'string')) return null;
  if (!Number.isFinite(tok.mintedAt) || !Number.isFinite(tok.ttlMs)) return null;
  return tok;
}

// Read + structurally validate ALL per-skill Tier-2 session credentials minted by
// .claude/hooks/metta-session-mint.mjs under <cwd>/.metta/scratch/skill-session/.
// Each Tier-2 skill's mint hook writes its own <slug>.token file, so several skills
// invoked in one Claude Code session coexist without clobbering each other. Returns
// an array of { tok, file } pairs — each structurally valid token (possibly expired —
// expiry is judged at the call site) annotated with the directory-entry filename it
// was read from, so the re-prime writer targets exactly the path the token came from
// (read-path/write-path symmetry). Unreadable, unparsable, or malformed files are
// skipped. Never throws inside the offender predicate. The retired single-file
// credential at <cwd>/.metta/scratch/skill-session.token is deliberately NOT honored.
function readSessionTokens(cwd) {
  const tokenDir = join(cwd ?? process.cwd(), '.metta', 'scratch', 'skill-session');
  let names = [];
  try { names = readdirSync(tokenDir); } catch { return []; }
  const tokens = [];
  for (const name of names) {
    if (!name.endsWith('.token')) continue;
    try {
      const tok = validateToken(JSON.parse(readFileSync(join(tokenDir, name), 'utf8')));
      if (tok !== null) tokens.push({ tok, file: name });
    } catch {
      // skip unreadable/unparsable files
    }
  }
  return tokens;
}

// Best-effort atomic rewrite of a token whose authorization came only via the
// re-primable band: same payload, new random `token` value, `mintedAt = now`. The
// authorize decision has ALREADY been made when this runs — every failure here is
// swallowed, because a write failure must never revoke an authorization (fail-closed
// must not invert into fail-blocked-on-housekeeping). The target is the annotated
// directory-entry filename the token was actually read from; a defensive shape check
// (plain `<name>.token` entry, no path separators) guards the write path against a
// forged token steering it outside the token dir. Temp-file (mode 0o600) + renameSync
// in the same directory closes the torn-read window against a concurrently firing
// mint hook.
function reprimeToken(cwd, entry, now) {
  try {
    const name = entry.file;
    if (typeof name !== 'string' || !name.endsWith('.token')) return;
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return;
    const tokenDir = join(cwd ?? process.cwd(), '.metta', 'scratch', 'skill-session');
    const target = join(tokenDir, name);
    const next = { ...entry.tok, token: randomUUID(), mintedAt: now };
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
      renameSync(tmp, target);
    } catch {
      try { unlinkSync(tmp); } catch { /* best-effort orphan cleanup */ }
    }
  } catch {
    // Authorize-then-write: never let housekeeping failures surface (ADR-5).
  }
}

// Append one JSON line to <cwd>/.metta/logs/guard-bypass.log. Swallows all I/O errors so
// audit-log failures never break the hook's primary enforcement path.
function appendAuditLog(event, verdict, inv, reason, tier = null, extra = {}) {
  try {
    const cwd = event.cwd ?? process.cwd();
    const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log');
    const entry = {
      ts: new Date().toISOString(),
      verdict,
      subcommand: inv.sub ?? null,
      third: inv.third ?? null,
      agent_type: event.agent_type ?? null,
      reason,
      tier,
      event_keys: Object.keys(event),
      ...extra,
    };
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Audit log errors must not break the hook — swallow silently.
  }
}

async function main() {
  const raw = readStdin();
  if (!raw) { process.exit(0); }
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== 'Bash') process.exit(0);

  // Forked metta agents must complete all work synchronously — background Bash is
  // rejected outright, regardless of the command string (see the Synchronous
  // completion rule in .claude/agents/metta-skill-host.md).
  if (event.tool_input?.run_in_background === true && isTrustedSkillCaller(event)) {
    appendAuditLog(event, 'block', { sub: null, third: null }, 'background-bash-from-fork', 'fork');
    process.stderr.write(
      `metta-guard-bash: Blocked Bash run_in_background from a forked metta agent (${event.agent_type}).\n` +
      `Forked skills MUST NOT end their turn with background work in flight — see the ` +
      `Synchronous completion rule in .claude/agents/metta-skill-host.md.\n` +
      `Run the command in the foreground and wait for it to complete before reporting.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  const command = event.tool_input?.command ?? '';

  // Layer-2 worktree write-target check. Placed BEFORE the offender scan (design
  // D8): a command blocked for write-target reasons must never act as a Tier-2
  // credential keepalive — the deferred re-prime writes in the !offender branch
  // below only run when every invocation is authorized, and this check exits
  // before any of that machinery is consulted. Fast path: extractWriteTargets
  // returns [] for the overwhelming majority of commands -> zero subprocess
  // cost. The whole check fails open on any error.
  try {
    const targets = extractWriteTargets(command);
    if (targets.length > 0) {
      const { hit, droppedTargets, budgetExhausted } = await checkWriteTargets(targets);
      if (hit) {
        appendAuditLog(event, 'block', { sub: null, third: null }, 'worktree-write-target', null,
          { target: hit.target, mainRoot: hit.mainRoot, worktreeRoot: hit.worktreeRoot });
        process.stderr.write(
          `metta-guard-bash: Blocked bash write target '${hit.target}'.\n` +
          `It resolves into the MAIN checkout '${hit.mainRoot}' while that checkout's active\n` +
          `change is worktree-hosted. All file writes for this change must target absolute\n` +
          `paths under the change_root prefix:\n` +
          `  ${hit.worktreeRoot}\n` +
          `Write under that worktree instead, or use the Edit tool (which applies its own\n` +
          `guard-edit allow-list).\n` +
          `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
        );
        process.exit(2);
      }
      // Fail-open visibility (review round-2 F4): an allow that reaches here
      // after targets were dropped (cap) or abandoned (budget) is NOT "all
      // targets checked clean" — record the distinction so forensics can tell
      // the two apart. Non-blocking by construction: appendAuditLog swallows
      // its own I/O errors and this whole check is wrapped fail-open.
      if (droppedTargets > 0) {
        appendAuditLog(event, 'allow', { sub: null, third: null }, 'write-target-cap-exceeded', null,
          { dropped_targets: droppedTargets, cap: MAX_WRITE_TARGET_CHECKS });
      }
      if (budgetExhausted) {
        appendAuditLog(event, 'allow', { sub: null, third: null }, 'write-target-budget-exhausted', null,
          { budget_ms: WRITE_TARGET_BUDGET_MS });
      }
    }
  } catch {
    // Whole write-target check fails open: extraction/probe errors never block.
  }

  const invocations = tokenize(command);

  // Find the first invocation that is not allowed. SKILL_ENFORCED_SUBCOMMANDS (Tier 1) are
  // authorized solely by a verified fork caller identity (isTrustedSkillCaller); every other
  // blocked subcommand (Tier 2) is authorized by a verified fork caller identity OR a valid
  // session credential. The Tier-2 rejection reason (if any) is threaded through tier2Reason
  // to the verdict block below; Tier-2 acceptances are collected for audit logging.
  let tier2Reason = null;
  let tier2Staleness = null;
  const tier2Accepted = [];
  const offender = invocations.find((inv) => {
    if (classify(inv) === 'allow') return false; // never an offender
    // A `--` operand terminator fails closed unconditionally — no tier, fork identity,
    // or session credential can authorize it (see classify()).
    if (inv.hasDoubleDash) return true;
    // Tier 1: enforced skill subcommands are authorized by trusted fork caller identity alone
    if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
      return !isTrustedSkillCaller(event);
    }
    // Tier 2: fork body calling a Tier-2 sub from inside a Tier-1 skill's own body
    if (isTrustedSkillCaller(event)) {
      tier2Accepted.push({ inv, reason: 'session-credential-verified', staleness_ms: null, needsReprime: false, entry: null, now: null });
      return false;
    }
    const tokens = readSessionTokens(event.cwd);
    if (tokens.length === 0) { tier2Reason = 'missing-credential'; return true; }
    const now = Date.now();
    // Two-band freshness (verdict is a pure function of token file state, event fields,
    // and the clock — never of whether the separately scheduled mint hook has already
    // fired on this event, so the outcome is invariant under parallel hook ordering):
    // - Fresh band: within ttlMs — unchanged pre-fix predicate.
    // - Re-primable band: token stamped with THIS session's runtime-supplied session_id
    //   (same trust class as Tier 1's agent_type; never command text) AND within the
    //   bounded effective lifetime ttlMs + GRACE_MS. A missing/non-string
    //   event.session_id disables the band entirely — fail-closed pre-fix behavior.
    const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
    const fresh = tokens.filter((t) => now - t.tok.mintedAt < t.tok.ttlMs);
    const reprimable = tokens.filter((t) =>
      sessionId !== null &&
      t.tok.sessionId === sessionId &&
      now - t.tok.mintedAt < t.tok.ttlMs + GRACE_MS);
    const eligible = [...new Set([...fresh, ...reprimable])];
    if (eligible.length === 0) {
      // Genuinely dead: no fresh token AND no re-primable token. staleness_ms records
      // the age of the youngest structurally valid token considered (horizon tuning).
      tier2Reason = 'credential-expired';
      tier2Staleness = Math.min(...tokens.map((t) => now - t.tok.mintedAt));
      return true;
    }
    // Scope key: two-word blocked forms (e.g. `backlog add`) are keyed "<sub>:<third>";
    // single-word blocked subcommands keep their bare name even when followed by an
    // argument (e.g. `complete intent` -> key "complete"), mirroring classify().
    const blockedTwo = BLOCKED_TWO_WORD.get(inv.sub);
    const key = blockedTwo && inv.third && blockedTwo.has(inv.third)
      ? `${inv.sub}:${inv.third}`
      : inv.sub;
    // Any-valid-token authorization: a call is in scope if ANY eligible per-skill
    // token covers it — a stale-but-eligible token from a different skill never blocks
    // the genuinely active skill's own credential. The re-prime band contributes
    // freshness only, never scope: subcommands filtering is unchanged.
    const inScope = eligible.filter((t) => t.tok.subcommands.includes(key));
    if (inScope.length === 0) { tier2Reason = 'subcommand-not-in-scope'; return true; }
    // Accept. Select the authorizing token explicitly: a fresh-band token is
    // preferred as the authorizing token whenever one is in scope; only when NO
    // in-scope token is fresh does authorization fall to the re-prime band. Both
    // the (deferred) re-prime target and the logged staleness_ms are attributed
    // to this authorizing token — never to whichever token happens to sit first
    // in directory/spread order.
    const viaFresh = inScope.some((t) => fresh.includes(t));
    const authTok = viaFresh ? inScope.find((t) => fresh.includes(t)) : inScope[0];
    // The scan only RECORDS the acceptance (including whether a re-prime write is
    // needed); the write itself is deferred to the !offender branch below so a
    // blocked command leaves every token file byte-untouched.
    tier2Accepted.push({
      inv,
      reason: viaFresh ? 'session-credential-verified' : 'session-credential-reprimed',
      staleness_ms: now - authTok.tok.mintedAt,
      needsReprime: !viaFresh,
      entry: authTok,
      now,
    });
    return false;
  });

  if (!offender) {
    // Authorize-then-write, whole-command scoped: re-prime writes and acceptance
    // logging run only after EVERY invocation in the command has been authorized.
    // A blocked command (any offending segment) therefore never rewrites a token —
    // no silent credential keepalive via deliberately-blocked compound commands.
    // The write stays best-effort: a re-prime failure never revokes authorization.
    for (const acc of tier2Accepted) {
      if (acc.needsReprime) reprimeToken(event.cwd, acc.entry, acc.now);
      appendAuditLog(event, 'allow', acc.inv, acc.reason, 'session', { staleness_ms: acc.staleness_ms });
    }
    process.exit(0);
  }

  const verdict = classify(offender);
  const subDisplay = `metta ${offender.sub ?? ''}${offender.third ? ' ' + offender.third : ''}`.trim();

  // `--` operand terminator: blocked unconditionally with a dedicated message, before
  // any tier-specific handling — Commander dispatches what follows `--` as a subcommand,
  // so this path never consults fork identity or session credentials.
  if (offender.hasDoubleDash) {
    appendAuditLog(event, 'block', offender, 'double-dash-operand-terminator', null);
    process.stderr.write(
      `metta-guard-bash: Blocked metta invocation containing a '--' operand terminator in '${subDisplay}'.\n` +
      `The '--' operand terminator is not permitted, whether bare or quoted (e.g. '--', "--",\n` +
      `or '""--' all count): Commander still dispatches what follows it as a subcommand (e.g.\n` +
      `'metta backlog --json -- add x' and 'metta backlog --json "--" add x' both run\n` +
      `'backlog add'), so any metta invocation containing '--' fails closed. Re-run the\n` +
      `command without '--'.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  // Skill-enforced subcommand blocked because the caller lacks a trusted agent_type.
  // Inline command text alone never authorizes a fork-tier subcommand.
  if (SKILL_ENFORCED_SUBCOMMANDS.has(offender.sub)) {
    const skillHint = SKILL_HINT_MAP.get(offender.sub) ?? '/metta-<skill>';
    appendAuditLog(event, 'block', offender, 'skill-enforced subcommand without trusted agent_type', 'fork');
    process.stderr.write(
      `metta-guard-bash: Blocked skill-enforced subcommand '${subDisplay}' from AI orchestrator session.\n` +
      `Use the matching skill via the Skill tool: ${skillHint}\n` +
      `Inline command text never authorizes skill-enforced subcommands — dispatch via the Skill tool.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  if (verdict === 'unknown') {
    appendAuditLog(event, 'block', offender, 'unknown', null);
    process.stderr.write(
      `metta-guard-bash: Blocked unknown metta subcommand '${offender.sub}' in '${subDisplay}'.\n` +
      `Update the allowlist in metta-guard-bash.mjs if this is a legitimate read-only command.\n` +
      `Skill-internal lifecycle calls are authorized by the session credential minted when the\n` +
      `matching /metta-<skill> skill is invoked — use the Skill tool entry point, not the CLI.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  // verdict === 'block' — Tier-2 rejections carry their threaded reason and session tier;
  // any other path defaults to the generic 'block' reason with no tier. On
  // credential-expired blocks, staleness_ms carries the age of the youngest structurally
  // valid token considered.
  appendAuditLog(event, 'block', offender, tier2Reason ?? 'block', tier2Reason ? 'session' : null,
    tier2Staleness !== null ? { staleness_ms: tier2Staleness } : {});
  process.stderr.write(
    `metta-guard-bash: Blocked direct CLI call '${subDisplay}' from AI orchestrator session.\n` +
    `Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping.\n` +
    `Skill-internal lifecycle calls are authorized by the per-skill session credential the\n` +
    `skill's entry point mints at .metta/scratch/skill-session/<skill>.token — never by\n` +
    `inline command text.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}

main();
