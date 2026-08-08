#!/usr/bin/env node
// SubagentStop hook: automatic per-subagent token recording.
//
// COMPATIBILITY COUPLING — Claude Code >= 2.1.226:
// This hook depends on the SubagentStop event payload carrying `agent_type`
// and `agent_transcript_path` exactly as delivered by Claude Code 2.1.226.
// Those fields are not a stable public contract — RE-VERIFY the payload shape
// against this pipeline after every Claude Code upgrade before trusting the
// recorded totals.
//
// Pipeline: stdin JSON -> only `metta-*` agent_type -> read the subagent
// transcript (JSONL) -> sum input_tokens + output_tokens across assistant
// records carrying a `message.usage` object -> shell out to
// `metta tokens record ... --source hook` in the session cwd.
//
// Failure policy: this hook NEVER emits a decision. It writes nothing to
// stdout, writes nothing into .metta/ itself (the metta CLI owns that store),
// never retries, and exits 0 on every path. All diagnostics go to stderr
// prefixed "metta-tokens-record:".

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Static subagent -> task-id map. Unmapped metta-* agents fall back to the
// agent_type itself so the record is still attributable.
const AGENT_TASK_MAP = {
  'metta-proposer': 'intent',
  'metta-specifier': 'spec',
  'metta-product': 'stories',
  'metta-researcher': 'research',
  'metta-architect': 'design',
  'metta-planner': 'tasks',
  'metta-executor': 'implementation',
  'metta-reviewer': 'implementation',
  'metta-verifier': 'verification',
};

// Model families the tokens store prices distinctly; anything else records as
// 'inherit' (the CLI's "same model as the session" sentinel).
const MODEL_FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];

function logStderr(detail) {
  try {
    const text = detail instanceof Error ? detail.message : String(detail);
    process.stderr.write(`metta-tokens-record: ${text.replace(/\n/g, ' ')}\n`);
  } catch {
    // stderr write failures are themselves swallowed
  }
}

async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function toCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function mapModel(modelId) {
  if (typeof modelId !== 'string') return 'inherit';
  const lower = modelId.toLowerCase();
  for (const family of MODEL_FAMILIES) {
    if (lower.includes(family)) return family;
  }
  return 'inherit';
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (payload === null || typeof payload !== 'object') return;

  const agentType = payload.agent_type;
  if (typeof agentType !== 'string' || !agentType.startsWith('metta-')) return;

  const transcriptPath = payload.agent_transcript_path;
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return;

  let transcript;
  try {
    transcript = await readFile(transcriptPath, 'utf8');
  } catch {
    return;
  }

  const sums = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let usageRecords = 0;
  let lastModel;

  for (const line of transcript.split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // malformed lines are skipped, never fatal
    }
    if (record === null || typeof record !== 'object') continue;
    if (record.type !== 'assistant') continue;
    const message = record.message;
    if (message === null || typeof message !== 'object') continue;
    const usage = message.usage;
    if (usage === null || typeof usage !== 'object') continue;

    usageRecords += 1;
    sums.input_tokens += toCount(usage.input_tokens);
    sums.output_tokens += toCount(usage.output_tokens);
    sums.cache_creation_input_tokens += toCount(usage.cache_creation_input_tokens);
    sums.cache_read_input_tokens += toCount(usage.cache_read_input_tokens);
    lastModel = message.model;
  }

  // Billed total is input + output only; cache components are tracked in the
  // diagnostics but intentionally excluded from the recorded sum.
  const total = sums.input_tokens + sums.output_tokens;
  if (usageRecords === 0 || !Number.isInteger(total) || total <= 0) return;

  const task = Object.prototype.hasOwnProperty.call(AGENT_TASK_MAP, agentType)
    ? AGENT_TASK_MAP[agentType]
    : agentType;
  const model = mapModel(lastModel);

  logStderr(
    `recording ${total} tokens for ${agentType} (task=${task} model=${model} ` +
      `input=${sums.input_tokens} output=${sums.output_tokens} ` +
      `cache_creation=${sums.cache_creation_input_tokens} cache_read=${sums.cache_read_input_tokens})`,
  );

  try {
    await execFileAsync(
      'metta',
      [
        'tokens',
        'record',
        '--task',
        task,
        '--agent',
        agentType,
        '--model',
        model,
        '--tokens',
        String(total),
        '--source',
        'hook',
      ],
      { cwd: payload.cwd ?? process.cwd(), timeout: 30_000 },
    );
  } catch (error) {
    // Non-zero exit, ENOENT (metta not on PATH), timeout — all non-fatal.
    logStderr(`metta tokens record failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
  }
}

main()
  .catch(logStderr)
  .finally(() => process.exit(0));
