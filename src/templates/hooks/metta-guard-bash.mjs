#!/usr/bin/env node
// PreToolUse Bash hook: block direct metta state-mutating CLI calls from AI orchestrator sessions.
// Primary skill-initiated bypass: inline env-var prefix `METTA_SKILL=1 metta ...` in the command string.
// Secondary bypass: process.env.METTA_SKILL === '1' (belt-and-suspenders).
// Emergency bypass: disable hook in .claude/settings.local.json.

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Explicit ALLOW list: known safe read-only single-subcommand forms.
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'instructions', 'progress', 'doctor',
  'iteration', // counter-only instrumentation; skills call it during fan-out. Read-safe-ish; no state-mutating side effects beyond a per-change counter.
  'install', // intentional pass-through for human/CI-driven install (no matching skill yet)
]);

// Explicit ALLOW list for two-word read-only forms.
const ALLOWED_TWO_WORD = new Map([
  ['issues', new Set(['list'])],
  ['gate', new Set(['list'])],
  ['changes', new Set(['list'])],
  ['backlog', new Set(['list', 'show'])],
]);

// Explicit BLOCK list: state-mutating single-subcommand forms.
const BLOCKED_SUBCOMMANDS = new Set([
  'propose', 'quick', 'auto', 'complete', 'finalize', 'ship',
  'issue', 'fix-issue', 'fix-gap', 'refresh', 'import', 'init',
]);

// Explicit BLOCK list for two-word mutating forms.
const BLOCKED_TWO_WORD = new Map([
  ['backlog', new Set(['add', 'done', 'promote'])],
  ['changes', new Set(['abandon'])],
]);

// Subcommands that require BOTH inline METTA_SKILL=1 bypass AND a trusted agent_type
// (caller identity set by the Claude Code runtime when a forked metta-* subagent fires the tool).
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

function tokenize(command) {
  // Split on whitespace, follow && / ; / | chains, find all `metta` invocations.
  // For each metta invocation, capture whether an inline env-var prefix included METTA_SKILL=1
  // (this is the primary skill-initiated bypass mechanism; the hook process's own env does
  // NOT see inline-prefixed vars — they apply to bash's future subprocess).
  // Return array of { sub, third, skillBypass }.
  const results = [];
  const tokens = command.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    let skillBypass = false;
    // Consume env-var prefixes (FOO=BAR, METTA_SKILL=1, ...)
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      if (tokens[i] === 'METTA_SKILL=1') skillBypass = true;
      i++;
    }
    if (tokens[i] === 'metta') {
      results.push({ sub: tokens[i + 1], third: tokens[i + 2], skillBypass });
      // Skip the rest of this command's arguments up to the next chain separator
      // so words inside a quoted argument (e.g. a propose description that mentions
      // "metta finalize") are not misparsed as a second invocation.
      i += 1;
      while (i < tokens.length && !['&&', ';', '||', '|'].includes(tokens[i])) i++;
      i++; // skip the separator
      continue;
    }
    // Skip until we see a chain separator
    while (i < tokens.length && !['&&', ';', '||', '|'].includes(tokens[i])) i++;
    i++; // skip the separator
  }
  return results;
}

// Classification result: 'allow' | 'block' | 'unknown'
function classify(inv) {
  if (!inv.sub) return 'allow'; // bare `metta` — harmless
  if (ALLOWED_SUBCOMMANDS.has(inv.sub)) return 'allow';
  const allowedTwo = ALLOWED_TWO_WORD.get(inv.sub);
  if (allowedTwo && inv.third && allowedTwo.has(inv.third)) return 'allow';
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

// Read + structurally validate the Tier-2 session credential minted by
// .claude/hooks/metta-session-mint.mjs at <cwd>/.metta/scratch/skill-session.token.
// Returns null on any I/O or parse error, AND on any shape mismatch (token must be a
// non-empty string, skill a string, subcommands an array of strings, mintedAt/ttlMs
// finite numbers) — so a valid-JSON-wrong-shape file fails closed as missing-credential
// and this helper never throws inside the offender predicate.
function readSessionToken(cwd) {
  try {
    const tokenPath = join(cwd ?? process.cwd(), '.metta', 'scratch', 'skill-session.token');
    const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
    if (typeof tok !== 'object' || tok === null || Array.isArray(tok)) return null;
    if (typeof tok.token !== 'string' || tok.token.length === 0) return null;
    if (typeof tok.skill !== 'string') return null;
    if (!Array.isArray(tok.subcommands) || !tok.subcommands.every((s) => typeof s === 'string')) return null;
    if (!Number.isFinite(tok.mintedAt) || !Number.isFinite(tok.ttlMs)) return null;
    return tok;
  } catch {
    return null;
  }
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
      skill_bypass: Boolean(inv.skillBypass),
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

  // Belt-and-suspenders: honor env-var bypass if set on the hook process itself.
  if (process.env.METTA_SKILL === '1') process.exit(0);

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

  // Find the first invocation that is not allowed. For SKILL_ENFORCED_SUBCOMMANDS (Tier 1)
  // the call must carry BOTH the inline METTA_SKILL=1 bypass AND a trusted metta-* agent_type;
  // every other blocked subcommand (Tier 2) is authorized by a verified fork caller identity
  // OR a valid session credential. The Tier-2 rejection reason (if any) is threaded through
  // tier2Reason to the verdict block below; Tier-2 acceptances are collected for audit logging.
  let tier2Reason = null;
  const tier2Accepted = [];
  const offender = invocations.find((inv) => {
    if (classify(inv) === 'allow') return false; // never an offender
    // Tier 1, unchanged: enforced skill subcommands require BOTH inline bypass AND trusted agent_type
    if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
      return !(inv.skillBypass && isTrustedSkillCaller(event));
    }
    // Tier 2: fork body calling a Tier-2 sub from inside a Tier-1 skill's own body
    if (isTrustedSkillCaller(event)) {
      tier2Accepted.push(inv);
      return false;
    }
    // REMOVE-AFTER-SHIP: legacy inline METTA_SKILL=1 prefix, dual-accepted only during this
    // change's own migration window (see design.md Ordering Constraint). Deleted in the final
    // implementation task once the Tier-2 token path is test-proven.
    if (inv.skillBypass) return false;
    const tok = readSessionToken(event.cwd);
    if (!tok) { tier2Reason = 'missing-credential'; return true; }
    if (Date.now() - tok.mintedAt >= tok.ttlMs) { tier2Reason = 'credential-expired'; return true; }
    // Scope key: two-word blocked forms (e.g. `backlog add`) are keyed "<sub>:<third>";
    // single-word blocked subcommands keep their bare name even when followed by an
    // argument (e.g. `complete intent` -> key "complete"), mirroring classify().
    const blockedTwo = BLOCKED_TWO_WORD.get(inv.sub);
    const key = blockedTwo && inv.third && blockedTwo.has(inv.third)
      ? `${inv.sub}:${inv.third}`
      : inv.sub;
    if (!tok.subcommands.includes(key)) { tier2Reason = 'subcommand-not-in-scope'; return true; }
    tier2Accepted.push(inv);
    return false;
  });

  if (!offender) {
    // Log every Tier-2 acceptance (verified fork caller or valid session token) so the
    // audit trail records each session-tier authorization.
    for (const inv of tier2Accepted) {
      appendAuditLog(event, 'allow', inv, 'session-credential-verified', 'session');
    }
    // Transition window only (removed with the legacy fallback above): still log any
    // observed inline bypass on a non-enforced subcommand so the audit trail reflects
    // every legacy skill-bypass use.
    const firstBypassInv = invocations.find(
      (inv) => inv.skillBypass && !SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub) && classify(inv) !== 'allow' && !isTrustedSkillCaller(event),
    );
    if (firstBypassInv) {
      appendAuditLog(event, 'allow_with_bypass', firstBypassInv, 'non-enforced inline bypass');
    }
    process.exit(0);
  }

  const verdict = classify(offender);
  const subDisplay = `metta ${offender.sub ?? ''}${offender.third ? ' ' + offender.third : ''}`.trim();

  // Skill-enforced subcommand blocked because the caller lacks a trusted agent_type.
  // This is the new enforcement path: inline METTA_SKILL=1 alone is no longer sufficient.
  if (SKILL_ENFORCED_SUBCOMMANDS.has(offender.sub)) {
    const skillHint = SKILL_HINT_MAP.get(offender.sub) ?? '/metta-<skill>';
    appendAuditLog(event, 'block', offender, 'skill-enforced subcommand without trusted agent_type', 'fork');
    process.stderr.write(
      `metta-guard-bash: Blocked skill-enforced subcommand '${subDisplay}' from AI orchestrator session.\n` +
      `Use the matching skill via the Skill tool: ${skillHint}\n` +
      `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.\n` +
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
    `Skill-internal lifecycle calls are authorized by the session credential the skill's entry\n` +
    `point mints at .metta/scratch/skill-session.token — never by inline command text.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}

main();
