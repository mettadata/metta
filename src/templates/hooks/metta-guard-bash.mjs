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
//   rotated on a sliding TTL. A call is authorized when ANY structurally valid, unexpired
//   token's scope covers the subcommand — so one skill's credential never blocks another
//   active skill's. Not derivable from reading any skill file.
// Emergency bypass (humans/CI): disable this hook in .claude/settings.local.json.

import { readFileSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Explicit ALLOW list: known safe read-only single-subcommand forms.
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'instructions', 'progress', 'doctor',
  'next', // read-only routing query (`metta next --json`); first Bash call of the metta-next skill body
  'iteration', // counter-only instrumentation; skills call it during fan-out. Read-safe-ish; no state-mutating side effects beyond a per-change counter.
  'model-escalation', // audit-only instrumentation; skills call it during the execute/verify fix loop. Appends a per-change escalation record; no broader state-mutating side effects than the iteration counter has.
  'tokens', // append-only usage instrumentation; recording is hook-driven — a SubagentStop hook runs `metta tokens record` with harness-measured usage. Kept allowed for the manual `--source prose` fallback when the hook is unavailable. Appends a per-change token_usage record; no broader state-mutating side effects than model-escalation has.
  'install', // intentional pass-through for human/CI-driven install (no matching skill yet)
]);

// Explicit ALLOW list for two-word read-only forms.
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
const BLOCKED_SUBCOMMANDS = new Set([
  'propose', 'quick', 'auto', 'complete', 'finalize', 'ship',
  'issue', 'fix-issue', 'fix-gap', 'refresh', 'import', 'init',
  // `verify` runs gates (executes commands) — not read-only, so it is credential-gated
  // as Tier 2 rather than allow-listed.
  'verify',
]);

// Explicit BLOCK list for two-word mutating forms.
const BLOCKED_TWO_WORD = new Map([
  ['backlog', new Set(['add', 'done', 'promote', 'migrate'])],
  ['changes', new Set(['abandon'])],
  // `milestone create` mutates state (writes spec/milestones/<slug>.md) — Tier-2 scope
  // key 'milestone:create', minted only by the metta-backlog skill.
  ['milestone', new Set(['create'])],
  ['roadmap', new Set(['add', 'reorder', 'next'])],
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

// KNOWN LIMITATION (wrapper prefixes): textual guarding can only ever see the literal words
// bash executes. Wrappers such as `command metta finalize`, `env metta finalize`,
// `\metta finalize`, `xargs`, `sh -c '...'`, or a wrapper script that itself execs metta are
// invisible to this tokenizer — there is no bounded, enumerable list of wrappers to
// special-case, and a full bash-grammar parser is explicitly out of scope (see this change's
// intent.md). This is an accepted limitation of the text layer: defense in depth comes from
// the two-tier trust model (verified fork caller identity / minted session credentials) and
// the audit log below, not from trying to mechanically detect every possible indirection.

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

// True when `text` contains a bare `--` word that is NOT inside a single- or double-quoted
// span — Commander's operand terminator. Fails closed (returns true, matching the previous
// quote-unaware behavior) when the quoting in `text` cannot be confidently parsed, e.g. an
// unterminated quote: an unparseable input never gets the benefit of the doubt.
function hasUnquotedDoubleDash(text) {
  const { quoted, unterminated } = computeQuoteMask(text);
  const words = Array.from(text.matchAll(/\S+/g));
  if (unterminated) return words.some((m) => m[0] === '--');
  return words.some((m) => m[0] === '--' && !quoted[m.index] && !quoted[m.index + 1]);
}

function tokenize(command) {
  // Split into chain-separator-delimited segments first (see CHAIN_SEPARATOR_RE above), then
  // whitespace-tokenize each segment independently and look for a leading `metta` invocation.
  // Env-var prefixes (FOO=BAR ...) are consumed so the subcommand behind them is still
  // detected; inline command text (including any env-var prefix) never carries
  // authorization — Tier 1 trusts only the verified fork caller identity and Tier 2 trusts
  // only the minted session credential.
  // Return array of { sub, third, hasDoubleDash } where hasDoubleDash is true when an
  // unquoted bare `--` token appears ANYWHERE in the invocation's argument span (not just as
  // the third token) — Commander's operand terminator still dispatches what follows it as a
  // subcommand, so classify() fails such invocations closed.
  const results = [];
  const segments = command.split(CHAIN_SEPARATOR_RE);
  for (const segment of segments) {
    const tokens = Array.from(segment.matchAll(/\S+/g));
    let i = 0;
    // Consume env-var prefixes (FOO=BAR, ...)
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i][0])) i++;
    if (i >= tokens.length || tokens[i][0] !== 'metta') continue; // not an invocation in this segment
    const sub = tokens[i + 1]?.[0];
    const third = tokens[i + 2]?.[0];
    // A segment (already split on chain separators) contains exactly one command and its
    // arguments, so the argument span is simply everything after the `metta` word — no
    // further separator-skip walk is needed the way the pre-segmentation version required.
    const spanStart = tokens[i].index + tokens[i][0].length;
    const hasDoubleDash = hasUnquotedDoubleDash(segment.slice(spanStart));
    results.push({ sub, third, hasDoubleDash });
  }
  return results;
}

// Classification result: 'allow' | 'block' | 'unknown'
function classify(inv) {
  // Reject a bare `--` token ANYWHERE in the invocation's arguments: it is Commander's
  // operand terminator, and what follows it still dispatches as a subcommand (e.g.
  // `metta backlog -- add x` and `metta backlog --json -- add x` both run `backlog add`),
  // so any `--` fails closed as unknown regardless of allow-list membership. This
  // subsumes the earlier third-token-only `--` rejection. No legitimate metta CLI call
  // needs `--`.
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
// the array of structurally valid tokens (possibly expired — expiry is judged at the
// call site); unreadable, unparsable, or malformed files are skipped. Never throws
// inside the offender predicate. The retired single-file credential at
// <cwd>/.metta/scratch/skill-session.token is deliberately NOT honored.
function readSessionTokens(cwd) {
  const tokenDir = join(cwd ?? process.cwd(), '.metta', 'scratch', 'skill-session');
  let names = [];
  try { names = readdirSync(tokenDir); } catch { return []; }
  const tokens = [];
  for (const name of names) {
    if (!name.endsWith('.token')) continue;
    try {
      const tok = validateToken(JSON.parse(readFileSync(join(tokenDir, name), 'utf8')));
      if (tok !== null) tokens.push(tok);
    } catch {
      // skip unreadable/unparsable files
    }
  }
  return tokens;
}

// Append one JSON line to <cwd>/.metta/logs/guard-bypass.log. Swallows all I/O errors so
// audit-log failures never break the hook's primary enforcement path.
function appendAuditLog(event, verdict, inv, reason, tier = null) {
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
  const invocations = tokenize(command);

  // Find the first invocation that is not allowed. SKILL_ENFORCED_SUBCOMMANDS (Tier 1) are
  // authorized solely by a verified fork caller identity (isTrustedSkillCaller); every other
  // blocked subcommand (Tier 2) is authorized by a verified fork caller identity OR a valid
  // session credential. The Tier-2 rejection reason (if any) is threaded through tier2Reason
  // to the verdict block below; Tier-2 acceptances are collected for audit logging.
  let tier2Reason = null;
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
      tier2Accepted.push(inv);
      return false;
    }
    const tokens = readSessionTokens(event.cwd);
    if (tokens.length === 0) { tier2Reason = 'missing-credential'; return true; }
    const now = Date.now();
    const fresh = tokens.filter((tok) => now - tok.mintedAt < tok.ttlMs);
    if (fresh.length === 0) { tier2Reason = 'credential-expired'; return true; }
    // Scope key: two-word blocked forms (e.g. `backlog add`) are keyed "<sub>:<third>";
    // single-word blocked subcommands keep their bare name even when followed by an
    // argument (e.g. `complete intent` -> key "complete"), mirroring classify().
    const blockedTwo = BLOCKED_TWO_WORD.get(inv.sub);
    const key = blockedTwo && inv.third && blockedTwo.has(inv.third)
      ? `${inv.sub}:${inv.third}`
      : inv.sub;
    // Any-valid-token authorization: a call is in scope if ANY unexpired per-skill
    // token covers it — a stale-but-fresh token from a different skill never blocks
    // the genuinely active skill's own credential.
    if (!fresh.some((tok) => tok.subcommands.includes(key))) { tier2Reason = 'subcommand-not-in-scope'; return true; }
    tier2Accepted.push(inv);
    return false;
  });

  if (!offender) {
    // Log every Tier-2 acceptance (verified fork caller or valid session token) so the
    // audit trail records each session-tier authorization.
    for (const inv of tier2Accepted) {
      appendAuditLog(event, 'allow', inv, 'session-credential-verified', 'session');
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
      `metta-guard-bash: Blocked metta invocation containing a bare '--' in '${subDisplay}'.\n` +
      `The '--' operand terminator is not permitted: Commander still dispatches what follows\n` +
      `it as a subcommand (e.g. 'metta backlog --json -- add x' runs 'backlog add'), so any\n` +
      `metta invocation containing '--' fails closed. Re-run the command without '--'.\n` +
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
  // any other path defaults to the generic 'block' reason with no tier.
  appendAuditLog(event, 'block', offender, tier2Reason ?? 'block', tier2Reason ? 'session' : null);
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
