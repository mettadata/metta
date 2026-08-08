import { TemplateEngine } from '../templates/template-engine.js'
import type { TokenUsageRecord, ArtifactTiming } from '../schemas/change-metadata.js'

export interface TokensReportInput {
  changeName: string
  /** 'YYYY-MM-DD', injected by the caller — the generator MUST NOT read the clock. */
  generatedAt: string
  /** Orchestrator-reported usage records in append order. */
  tokenUsage: TokenUsageRecord[]
  /** Artifact timings from the change metadata; keys are artifact/task ids. */
  artifactTimings: Record<string, ArtifactTiming>
}

export interface TokensReportResult {
  markdown: string
}

// --- Pure helpers ------------------------------------------------------------

/** Deterministic thousands-separator formatting (locale-independent). */
function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort()
}

/** Group-and-sum by a record field, keys sorted lexicographically. */
function rollup(
  records: TokenUsageRecord[],
  key: (r: TokenUsageRecord) => string,
): Array<[string, number]> {
  const sums = new Map<string, number>()
  for (const record of records) {
    const k = key(record)
    sums.set(k, (sums.get(k) ?? 0) + record.tokens)
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function renderTable(header: string[], rows: string[][]): string {
  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}

const NO_USAGE = '_No token usage recorded._'
const NO_GAPS = 'No gaps found.'

function dedupeKey(r: TokenUsageRecord): string {
  return `${r.task}\u0000${r.agent}`
}

/**
 * Report-time dedupe: when both a hook-sourced (harness-measured, exact) and a
 * prose-sourced (orchestrator-estimated) record exist for the same
 * `task + agent` key, the hook record wins. Every hook record is kept; a
 * prose-sourced record (`source` absent or 'prose') is dropped only when a
 * same-key hook record exists. Pure — never mutates the input array.
 */
function dedupeTokenUsage(records: TokenUsageRecord[]): TokenUsageRecord[] {
  const hookKeys = new Set(records.filter(r => r.source === 'hook').map(dedupeKey))
  return records.filter(r => r.source === 'hook' || !hookKeys.has(dedupeKey(r)))
}

function provenance(r: TokenUsageRecord): string {
  return r.source === 'hook' ? 'hook (exact)' : 'prose (estimate)'
}

function renderPerArtifactTable(records: TokenUsageRecord[]): string {
  if (records.length === 0) return NO_USAGE
  return renderTable(
    ['Artifact/task', 'Agent', 'Model', 'Tokens', 'Provenance'],
    records.map(r => [r.task, r.agent, r.model, fmt(r.tokens), provenance(r)]),
  )
}

function renderRollup(label: string, entries: Array<[string, number]>): string {
  if (entries.length === 0) return NO_USAGE
  return renderTable([label, 'Tokens'], entries.map(([k, sum]) => [k, fmt(sum)]))
}

function renderSplit(records: TokenUsageRecord[]): string {
  let nonInherit = 0
  let inherit = 0
  for (const record of records) {
    if (record.model === 'inherit') inherit += record.tokens
    else nonInherit += record.tokens
  }
  return [
    `- **Cheap/pinned (non-inherit)**: ~${fmt(nonInherit)} tokens`,
    `- **Inherit**: ~${fmt(inherit)} tokens`,
  ].join('\n')
}

/**
 * Artifact-timing keys with no exact-match token usage record. Exact string
 * match is intentional: a fine-grained task id (e.g. `T1`) counts toward the
 * totals but does NOT clear an artifact-level gap (e.g. `tasks`).
 */
function computeGaps(
  tokenUsage: TokenUsageRecord[],
  artifactTimings: Record<string, ArtifactTiming>,
): string[] {
  return sortedKeys(artifactTimings).filter(k => !tokenUsage.some(r => r.task === k))
}

function renderGaps(gaps: string[]): string {
  if (gaps.length === 0) return NO_GAPS
  return gaps
    .map(gap => `- \`${gap}\` — run evidence with no token record; the recording hook missed this run`)
    .join('\n')
}

// --- Orchestration -----------------------------------------------------------

/**
 * Generate the tokens.md report for a change. Deterministic and clock-free:
 * `generatedAt` is caller-injected and the only I/O is the template read.
 */
export async function generateTokensReport(input: TokensReportInput): Promise<TokensReportResult> {
  const records = dedupeTokenUsage(input.tokenUsage)
  const total = records.reduce((sum, record) => sum + record.tokens, 0)
  const gaps = computeGaps(records, input.artifactTimings)

  const engine = new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])
  const markdown = await engine.render('tokens.md', {
    change_name: input.changeName,
    generated_date: input.generatedAt,
    total: `**~${fmt(total)} tokens** across ${records.length} record(s).`,
    per_artifact_table: renderPerArtifactTable(records),
    per_role_rollup: renderRollup('Agent', rollup(records, r => r.agent)),
    per_model_rollup: renderRollup('Model', rollup(records, r => r.model)),
    split: renderSplit(records),
    gaps: renderGaps(gaps),
  })

  return { markdown }
}
