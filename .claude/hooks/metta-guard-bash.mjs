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
      i += 3;
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

// Append one JSON line to <cwd>/.metta/logs/guard-bypass.log. Swallows all I/O errors so
// audit-log failures never break the hook's primary enforcement path.
function appendAuditLog(event, verdict, inv, reason) {
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

  const command = event.tool_input?.command ?? '';
  const invocations = tokenize(command);

  // Find the first invocation that is not allowed. For SKILL_ENFORCED_SUBCOMMANDS the call
  // must carry BOTH the inline METTA_SKILL=1 bypass AND a trusted metta-* agent_type; for
  // every other blocked subcommand the existing inline-bypass behavior is preserved.
  const offender = invocations.find((inv) => {
    if (classify(inv) === 'allow') return false; // never an offender
    // Enforced skill subcommands require BOTH inline bypass AND trusted agent_type
    if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
      return !(inv.skillBypass && isTrustedSkillCaller(event));
    }
    // Non-enforced subcommands: today's behavior — inline bypass is enough
    return !inv.skillBypass;
  });

  if (!offender) {
    // No offender — but still log any observed inline bypass on a non-enforced subcommand
    // so the audit trail reflects every skill-bypass use.
    const firstBypassInv = invocations.find(
      (inv) => inv.skillBypass && !SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub) && classify(inv) !== 'allow',
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
    appendAuditLog(event, 'block', offender, 'skill-enforced subcommand without trusted agent_type');
    process.stderr.write(
      `metta-guard-bash: Blocked skill-enforced subcommand '${subDisplay}' from AI orchestrator session.\n` +
      `Use the matching skill via the Skill tool: ${skillHint}\n` +
      `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  if (verdict === 'unknown') {
    appendAuditLog(event, 'block', offender, 'unknown');
    process.stderr.write(
      `metta-guard-bash: Blocked unknown metta subcommand '${offender.sub}' in '${subDisplay}'.\n` +
      `Update the allowlist in metta-guard-bash.mjs if this is a legitimate read-only command.\n` +
      `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  // verdict === 'block'
  appendAuditLog(event, 'block', offender, 'block');
  process.stderr.write(
    `metta-guard-bash: Blocked direct CLI call '${subDisplay}' from AI orchestrator session.\n` +
    `Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping.\n` +
    `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}

main();
