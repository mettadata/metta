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

function renderPerArtifactTable(records: TokenUsageRecord[]): string {
  if (records.length === 0) return NO_USAGE
  return renderTable(
    ['Artifact/task', 'Agent', 'Model', 'Tokens'],
    records.map(r => [r.task, r.agent, r.model, fmt(r.tokens)]),
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
  return gaps.map(gap => `- \`${gap}\` — timed artifact with no reported token usage`).join('\n')
}

// --- Orchestration -----------------------------------------------------------

/**
 * Generate the tokens.md report for a change. Deterministic and clock-free:
 * `generatedAt` is caller-injected and the only I/O is the template read.
 */
export async function generateTokensReport(input: TokensReportInput): Promise<TokensReportResult> {
  const total = input.tokenUsage.reduce((sum, record) => sum + record.tokens, 0)
  const gaps = computeGaps(input.tokenUsage, input.artifactTimings)

  const engine = new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])
  const markdown = await engine.render('tokens.md', {
    change_name: input.changeName,
    generated_date: input.generatedAt,
    total: `**~${fmt(total)} tokens** across ${input.tokenUsage.length} record(s).`,
    per_artifact_table: renderPerArtifactTable(input.tokenUsage),
    per_role_rollup: renderRollup('Agent', rollup(input.tokenUsage, r => r.agent)),
    per_model_rollup: renderRollup('Model', rollup(input.tokenUsage, r => r.model)),
    split: renderSplit(input.tokenUsage),
    gaps: renderGaps(gaps),
  })

  return { markdown }
}
