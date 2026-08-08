import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateTokensReport, type TokensReportInput } from '../src/finalize/tokens-report-generator.js'
import type { TokenUsageRecord, ArtifactTiming } from '../src/schemas/change-metadata.js'

const TEMPLATE_PATH = join(import.meta.dirname, '../src/templates/artifacts/tokens.md')

const TEMPLATE_PLACEHOLDERS = [
  '{change_name}',
  '{generated_date}',
  '{total}',
  '{per_artifact_table}',
  '{per_role_rollup}',
  '{per_model_rollup}',
  '{split}',
  '{gaps}',
] as const

// --- Fixture builders ---------------------------------------------------------

function record(over: Partial<TokenUsageRecord> = {}): TokenUsageRecord {
  return {
    task: 'intent',
    agent: 'metta-analyst',
    model: 'haiku',
    tokens: 1000,
    timestamp: '2026-01-15T10:00:00.000Z',
    ...over,
  }
}

function timing(): ArtifactTiming {
  return { started: '2026-01-15T09:00:00.000Z', completed: '2026-01-15T09:30:00.000Z' }
}

async function gen(over: Partial<TokensReportInput> = {}) {
  return generateTokensReport({
    changeName: 'test-change',
    generatedAt: '2026-01-15',
    tokenUsage: [],
    artifactTimings: {},
    ...over,
  })
}

describe('generateTokensReport', () => {
  // --- Sections and header ----------------------------------------------------

  it('renders all template sections with change name and injected date', async () => {
    const { markdown } = await gen({
      tokenUsage: [record()],
      artifactTimings: { intent: timing() },
    })

    expect(markdown).toContain('# Token usage: test-change')
    expect(markdown).toContain('- **Change**: test-change')
    expect(markdown).toContain('- **Generated**: 2026-01-15')
    expect(markdown).toContain('## Total')
    expect(markdown).toContain('## Per artifact')
    expect(markdown).toContain('## Per role')
    expect(markdown).toContain('## Per model')
    expect(markdown).toContain('## Cheap/pinned (non-inherit) vs inherit')
    expect(markdown).toContain('## Gaps')
    for (const placeholder of TEMPLATE_PLACEHOLDERS) {
      expect(markdown).not.toContain(placeholder)
    }
  })

  // --- Determinism ------------------------------------------------------------

  it('is byte-identical across two runs over identical inputs with a fixed date', async () => {
    const input: TokensReportInput = {
      changeName: 'test-change',
      generatedAt: '2026-01-15',
      tokenUsage: [
        record({ task: 'spec', agent: 'metta-architect', model: 'inherit', tokens: 2500 }),
        record({ task: 'intent', agent: 'metta-analyst', model: 'haiku', tokens: 1200 }),
      ],
      artifactTimings: { spec: timing(), tasks: timing() },
    }
    const first = await generateTokensReport(input)
    const second = await generateTokensReport(input)
    expect(first.markdown).toBe(second.markdown)
  })

  // --- Total ------------------------------------------------------------------

  it('sums all record tokens into the total', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ tokens: 1200 }),
        record({ task: 'spec', tokens: 2500 }),
        record({ task: 'T1', tokens: 300 }),
      ],
    })
    expect(markdown).toContain('**~4,000 tokens** across 3 record(s).')
  })

  // --- Per-artifact table -----------------------------------------------------

  it('renders per-artifact rows in record (append) order, not sorted', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'zeta', agent: 'metta-executor', model: 'sonnet', tokens: 10 }),
        record({ task: 'alpha', agent: 'metta-analyst', model: 'haiku', tokens: 20 }),
        record({ task: 'mid', agent: 'metta-verifier', model: 'inherit', tokens: 30 }),
      ],
    })
    expect(markdown).toContain('| Artifact/task | Agent | Model | Tokens |')
    const zeta = markdown.indexOf('| zeta | metta-executor | sonnet | 10 |')
    const alpha = markdown.indexOf('| alpha | metta-analyst | haiku | 20 |')
    const mid = markdown.indexOf('| mid | metta-verifier | inherit | 30 |')
    expect(zeta).toBeGreaterThan(-1)
    expect(alpha).toBeGreaterThan(zeta)
    expect(mid).toBeGreaterThan(alpha)
  })

  // --- Rollups ----------------------------------------------------------------

  it('rolls up per role sorted lexicographically with summed tokens', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'a', agent: 'metta-verifier', tokens: 100 }),
        record({ task: 'b', agent: 'metta-analyst', tokens: 200 }),
        record({ task: 'c', agent: 'metta-verifier', tokens: 50 }),
      ],
    })
    const section = markdown.slice(markdown.indexOf('## Per role'), markdown.indexOf('## Per model'))
    const analyst = section.indexOf('| metta-analyst | 200 |')
    const verifier = section.indexOf('| metta-verifier | 150 |')
    expect(analyst).toBeGreaterThan(-1)
    expect(verifier).toBeGreaterThan(analyst)
  })

  it('rolls up per model sorted lexicographically with summed tokens', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'a', model: 'sonnet', tokens: 100 }),
        record({ task: 'b', model: 'haiku', tokens: 200 }),
        record({ task: 'c', model: 'inherit', tokens: 400 }),
        record({ task: 'd', model: 'haiku', tokens: 25 }),
      ],
    })
    const section = markdown.slice(markdown.indexOf('## Per model'), markdown.indexOf('## Cheap/pinned'))
    const haiku = section.indexOf('| haiku | 225 |')
    const inherit = section.indexOf('| inherit | 400 |')
    const sonnet = section.indexOf('| sonnet | 100 |')
    expect(haiku).toBeGreaterThan(-1)
    expect(inherit).toBeGreaterThan(haiku)
    expect(sonnet).toBeGreaterThan(inherit)
  })

  // --- Split ------------------------------------------------------------------

  it('splits non-inherit vs inherit into two figures that sum to the total', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'a', model: 'haiku', tokens: 1000 }),
        record({ task: 'b', model: 'inherit', tokens: 2500 }),
        record({ task: 'c', model: 'sonnet', tokens: 500 }),
      ],
    })
    expect(markdown).toContain('- **Cheap/pinned (non-inherit)**: ~1,500 tokens')
    expect(markdown).toContain('- **Inherit**: ~2,500 tokens')
    expect(markdown).toContain('**~4,000 tokens** across 3 record(s).')
  })

  // --- Gaps -------------------------------------------------------------------

  it('lists timing keys without exact-match usage as gaps, sorted lexicographically', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'spec' })],
      artifactTimings: { tasks: timing(), intent: timing(), spec: timing() },
    })
    const intent = markdown.indexOf('- `intent` — timed artifact with no reported token usage')
    const tasks = markdown.indexOf('- `tasks` — timed artifact with no reported token usage')
    expect(intent).toBeGreaterThan(-1)
    expect(tasks).toBeGreaterThan(intent)
    expect(markdown).not.toContain('- `spec` —')
    expect(markdown).not.toContain('No gaps found.')
  })

  it('counts fine-grained task ids (T1) in totals but does NOT clear an artifact-level gap', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'T1', agent: 'metta-executor', model: 'sonnet', tokens: 750 })],
      artifactTimings: { tasks: timing() },
    })
    expect(markdown).toContain('**~750 tokens** across 1 record(s).')
    expect(markdown).toContain('| T1 | metta-executor | sonnet | 750 |')
    expect(markdown).toContain('- `tasks` — timed artifact with no reported token usage')
  })

  it('produces fully-populated gaps when usage is empty but timings exist', async () => {
    const { markdown } = await gen({
      tokenUsage: [],
      artifactTimings: { spec: timing(), intent: timing() },
    })
    const intent = markdown.indexOf('- `intent` — timed artifact with no reported token usage')
    const spec = markdown.indexOf('- `spec` — timed artifact with no reported token usage')
    expect(intent).toBeGreaterThan(-1)
    expect(spec).toBeGreaterThan(intent)
    expect(markdown).toContain('**~0 tokens** across 0 record(s).')
    expect(markdown).toContain('_No token usage recorded._')
  })

  it('renders the explicit "No gaps found" line when timings and usage are both empty', async () => {
    const { markdown } = await gen({ tokenUsage: [], artifactTimings: {} })
    expect(markdown).toContain('No gaps found.')
    expect(markdown).toContain('- **Cheap/pinned (non-inherit)**: ~0 tokens')
    expect(markdown).toContain('- **Inherit**: ~0 tokens')
  })
})

// --- Template contract (per tests/uat-template-contract.test.ts precedent) -----

describe('tokens.md template contract', () => {
  it('contains all eight single-brace placeholders', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8')
    for (const placeholder of TEMPLATE_PLACEHOLDERS) {
      expect(template).toContain(placeholder)
    }
  })

  it('contains no double-brace tokens', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8')
    expect(template).not.toContain('{{')
  })
})
