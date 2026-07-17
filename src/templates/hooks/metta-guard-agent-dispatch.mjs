#!/usr/bin/env node
// PreToolUse Agent hook: reject backgrounded `Agent` dispatches from the fork context.
// This hook is scoped to `Agent` tool calls solely by being declared in
// `.claude/agents/metta-skill-host.md`'s own `hooks:` frontmatter — frontmatter
// registration is itself the caller-identity boundary, so the hook never branches on
// `event.agent_type` for authorization (it is recorded in the audit entry for
// forensic value only).
//
// Behavior:
// - Reject (exit 2 + audit log) exactly when `tool_input.run_in_background === true`.
// - Recognized pass-through shapes (`run_in_background` absent or `false`) exit 0
//   with no audit entry.
// - Any other value on the field (an unrecognized, possibly harness-drifted shape)
//   is an audited fail-open: exit 0, plus one audit-log record of the observed shape.
// - Reject, never rewrite: PreToolUse offers only block/allow — `tool_input` is
//   never mutated.
// Emergency bypass (humans/CI): disable this hook in .claude/settings.local.json,
// or remove the `hooks:` entry from .claude/agents/metta-skill-host.md.

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Append one JSON line to <cwd>/.metta/logs/guard-bypass.log — the same audit trail
// metta-guard-bash.mjs writes. Deliberately duplicated inline rather than shared via a
// .claude/hooks/lib/ module (design.md: each deployed hook stays independently
// `node --check`-able with no cross-file import graph). `subcommand`/`third` are null
// for schema parity with metta-guard-bash.mjs's JSONL entries — this hook does not
// classify CLI subcommands. Swallows all I/O errors so a logging failure never breaks
// the enforcement path.
function appendAuditLog(event, verdict, reason, extra = {}) {
  try {
    const cwd = event.cwd ?? process.cwd();
    const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log');
    const entry = {
      ts: new Date().toISOString(),
      verdict,
      subcommand: null,
      third: null,
      tool_name: 'Agent',
      agent_type: event.agent_type ?? null,
      subagent_type: event.tool_input?.subagent_type ?? null,
      reason,
      tier: 'fork',
      event_keys: Object.keys(event),
      ...extra,
    };
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Audit log errors must not break the hook — swallow silently.
  }
}

function main() {
  const raw = readStdin();
  if (!raw) { process.exit(0); }
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== 'Agent') process.exit(0);

  const flag = event.tool_input?.run_in_background;

  // Sole reject condition: the boolean literal `true` — nothing else.
  if (flag === true) {
    appendAuditLog(event, 'block', 'rejected-async-agent-dispatch');
    const caller = typeof event.agent_type === 'string' ? ` (caller: ${event.agent_type})` : '';
    process.stderr.write(
      `metta-guard-agent-dispatch: Blocked a backgrounded Agent dispatch (run_in_background: true)${caller}.\n` +
      `Re-issue this Agent dispatch in the foreground and wait for the outstanding dispatched child\n` +
      `to complete before returning — never end your turn with a dispatched child still in flight.\n` +
      `See the 'Synchronous completion (hard rule)' and 'Residual orphaning recovery protocol'\n` +
      `sections of .claude/agents/metta-skill-host.md.\n` +
      `Emergency bypass: disable this hook in .claude/settings.local.json, or remove the hooks:\n` +
      `entry from .claude/agents/metta-skill-host.md.\n`
    );
    process.exit(2);
  }

  // Recognized pass-through shapes: field absent (including tool_input absent) or the
  // boolean literal `false`. No audit entry — these are ordinary synchronous dispatches.
  if (flag === undefined || flag === false) {
    process.exit(0);
  }

  // Audited fail-open: `run_in_background` is present but is not a recognized boolean
  // shape (e.g. the string "true" after a harness reshape). The hook checks exactly one
  // field name and never guesses at drifted shapes — the dispatch passes through, and
  // the residual gap is covered by the Layer-3 recovery protocol, but the unrecognized
  // shape is recorded for forensics.
  let observed;
  try { observed = JSON.stringify(flag) ?? String(flag); } catch { observed = String(flag); }
  appendAuditLog(event, 'allow', 'fail-open-unrecognized-shape', {
    observed_run_in_background: observed,
  });
  process.exit(0);
}

main();
