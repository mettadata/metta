#!/usr/bin/env node
// PreToolUse Bash hook: block direct metta state-mutating CLI calls from AI orchestrator sessions.
// Primary skill-initiated bypass: inline env-var prefix `METTA_SKILL=1 metta ...` in the command string.
// Secondary bypass: process.env.METTA_SKILL === '1' (belt-and-suspenders).
// Emergency bypass: disable hook in .claude/settings.local.json.

import { readFileSync } from 'node:fs';

// Explicit ALLOW list: known safe read-only single-subcommand forms.
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'instructions', 'progress', 'doctor',
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

  // Find the first invocation that is not skill-bypassed AND is not classified as allow.
  const offender = invocations.find(
    (inv) => !inv.skillBypass && classify(inv) !== 'allow',
  );
  if (!offender) process.exit(0);

  const verdict = classify(offender);
  const subDisplay = `metta ${offender.sub ?? ''}${offender.third ? ' ' + offender.third : ''}`.trim();

  if (verdict === 'unknown') {
    process.stderr.write(
      `metta-guard-bash: Blocked unknown metta subcommand '${offender.sub}' in '${subDisplay}'.\n` +
      `Update the allowlist in metta-guard-bash.mjs if this is a legitimate read-only command.\n` +
      `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
    );
    process.exit(2);
  }

  // verdict === 'block'
  process.stderr.write(
    `metta-guard-bash: Blocked direct CLI call '${subDisplay}' from AI orchestrator session.\n` +
    `Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping.\n` +
    `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}

main();
