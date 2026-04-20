#!/usr/bin/env node
// PreToolUse Bash hook: block direct metta state-mutating CLI calls from AI orchestrator sessions.
// Skill-initiated calls bypass via METTA_SKILL=1 env var.
// Emergency bypass: disable hook in .claude/settings.local.json.

import { readFileSync } from 'node:fs';

const BLOCKED_SUBCOMMANDS = new Set([
  'propose', 'quick', 'auto', 'complete', 'finalize', 'ship',
  'issue', 'fix-issue', 'fix-gap', 'refresh', 'import', 'install', 'init',
]);
const BLOCKED_TWO_WORD = new Map([
  ['backlog', new Set(['add', 'done', 'promote'])],
  ['changes', new Set(['abandon'])],
]);

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function tokenize(command) {
  // Split on whitespace, ignore leading FOO=bar env prefix, follow && chains, find all `metta` invocations.
  // Return array of { cmd: 'metta', sub: 'propose', third: 'add' | undefined } for each metta invocation.
  const results = [];
  const tokens = command.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    // Skip env-var prefixes (FOO=BAR)
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (tokens[i] === 'metta') {
      results.push({ cmd: 'metta', sub: tokens[i + 1], third: tokens[i + 2] });
      i += 3;
      continue;
    }
    // Skip until we see && or ; or |
    while (i < tokens.length && !['&&', ';', '||', '|'].includes(tokens[i])) i++;
    i++; // skip the separator
  }
  return results;
}

function isBlocked(inv) {
  if (!inv.sub) return false;
  if (BLOCKED_SUBCOMMANDS.has(inv.sub)) return true;
  const twoWord = BLOCKED_TWO_WORD.get(inv.sub);
  if (twoWord && inv.third && twoWord.has(inv.third)) return true;
  return false;
}

async function main() {
  // Non-Bash events pass through
  const raw = readStdin();
  if (!raw) { process.exit(0); }
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== 'Bash') process.exit(0);

  // Skill-initiated calls bypass
  if (process.env.METTA_SKILL === '1') process.exit(0);

  const command = event.tool_input?.command ?? '';
  const invocations = tokenize(command);
  const blocked = invocations.find(isBlocked);
  if (!blocked) process.exit(0);

  const skillName = blocked.sub === 'backlog'
    ? 'metta-backlog'
    : blocked.sub === 'changes'
      ? 'metta-ship'  // or similar
      : `metta-${blocked.sub}`;

  process.stderr.write(
    `metta-guard-bash: Blocked direct CLI call 'metta ${blocked.sub}${blocked.third ? ' ' + blocked.third : ''}' from AI orchestrator session.\n` +
    `Use the matching skill via the Skill tool: /${skillName}.\n` +
    `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}

main();
