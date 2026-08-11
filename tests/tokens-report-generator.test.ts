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

const GAP_LINE = (key: string) =>
  `- \`${key}\` — run evidence with no token record; the recording hook missed this run`

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
    expect(markdown).toContain('| Artifact/task | Agent | Model | Tokens | Provenance |')
    const zeta = markdown.indexOf('| zeta | metta-executor | sonnet | 10 | prose (estimate) |')
    const alpha = markdown.indexOf('| alpha | metta-analyst | haiku | 20 | prose (estimate) |')
    const mid = markdown.indexOf('| mid | metta-verifier | inherit | 30 | prose (estimate) |')
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
    const intent = markdown.indexOf(GAP_LINE('intent'))
    const tasks = markdown.indexOf(GAP_LINE('tasks'))
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
    expect(markdown).toContain('| T1 | metta-executor | sonnet | 750 | prose (estimate) |')
    expect(markdown).toContain(GAP_LINE('tasks'))
  })

  it('produces fully-populated gaps when usage is empty but timings exist', async () => {
    const { markdown } = await gen({
      tokenUsage: [],
      artifactTimings: { spec: timing(), intent: timing() },
    })
    const intent = markdown.indexOf(GAP_LINE('intent'))
    const spec = markdown.indexOf(GAP_LINE('spec'))
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

  it('lists a hook-coverage gap when artifact_timings has a key with no token record', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'spec', source: 'hook' })],
      artifactTimings: { implementation: timing(), spec: timing() },
    })
    expect(markdown).toContain(GAP_LINE('implementation'))
    expect(markdown).not.toContain('- `spec` —')
    expect(markdown).not.toContain('No gaps found.')
  })

  it('renders "No gaps found." when every timed artifact has a token record', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'implementation', agent: 'metta-executor', source: 'hook' })],
      artifactTimings: { implementation: timing() },
    })
    expect(markdown).toContain('No gaps found.')
  })

  // --- Hook health tripwire ---------------------------------------------------

  const TRIPWIRE_MARK = '- **Hook health failure**: 0 automatic (hook-sourced) token records despite'

  it('flags a hook health failure when usage is empty but artifacts completed', async () => {
    const { markdown } = await gen({
      tokenUsage: [],
      artifactTimings: { spec: timing(), intent: timing() },
    })
    const section = markdown.slice(markdown.indexOf('## Gaps'))
    expect(section).toContain(
      `${TRIPWIRE_MARK} 2 completed artifact(s) — the SubagentStop token-recording hook likely ` +
      `failed to reach the CLI (stale globally-linked dist or hook-to-CLI path failure). ` +
      `Token data for this change was not captured automatically.`,
    )
    expect(section).not.toContain('No gaps found.')
  })

  it('flags a hook health failure when only prose records exist for completed artifacts', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'intent', source: 'prose' })],
      artifactTimings: { intent: timing() },
    })
    expect(markdown).toContain(`${TRIPWIRE_MARK} 1 completed artifact(s)`)
  })

  it('stays silent when at least one hook-sourced record exists', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'intent', source: 'hook' })],
      artifactTimings: { intent: timing(), spec: timing() },
    })
    expect(markdown).not.toContain(TRIPWIRE_MARK)
  })

  it('stays silent when no artifacts completed (genuinely zero subagent activity)', async () => {
    const { markdown } = await gen({ tokenUsage: [], artifactTimings: {} })
    expect(markdown).not.toContain(TRIPWIRE_MARK)
    expect(markdown).toContain('No gaps found.')
  })

  it('does not count a started-but-uncompleted timing toward the tripwire', async () => {
    const { markdown } = await gen({
      tokenUsage: [],
      artifactTimings: { intent: { started: '2026-01-15T09:00:00.000Z' } },
    })
    expect(markdown).not.toContain(TRIPWIRE_MARK)
  })

  it('renders the tripwire entry above per-artifact coverage gap lines', async () => {
    const { markdown } = await gen({
      tokenUsage: [],
      artifactTimings: { intent: timing() },
    })
    const tripwire = markdown.indexOf(TRIPWIRE_MARK)
    const coverageGap = markdown.indexOf(GAP_LINE('intent'))
    expect(tripwire).toBeGreaterThan(-1)
    expect(coverageGap).toBeGreaterThan(tripwire)
  })

  // --- Report-time dedupe -----------------------------------------------------

  it('counts a duplicate hook+prose pair for the same task+agent once, at the hook figure', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 40000, source: 'prose' }),
        record({ task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 41250, source: 'hook' }),
      ],
    })
    expect(markdown).toContain('**~41,250 tokens** across 1 record(s).')
    expect(markdown).toContain('| implementation | metta-executor | sonnet | 41,250 | hook (exact) |')
    expect(markdown).not.toContain('40,000')
    expect(markdown).toContain('| metta-executor | 41,250 |')
    expect(markdown).toContain('| sonnet | 41,250 |')
    expect(markdown).toContain('- **Cheap/pinned (non-inherit)**: ~41,250 tokens')
  })

  it('retains a legacy prose-only record (no source) everywhere as prose (estimate)', async () => {
    const { markdown } = await gen({
      tokenUsage: [record({ task: 'intent', agent: 'metta-analyst', model: 'haiku', tokens: 1200 })],
    })
    expect(markdown).toContain('**~1,200 tokens** across 1 record(s).')
    expect(markdown).toContain('| intent | metta-analyst | haiku | 1,200 | prose (estimate) |')
    expect(markdown).toContain('| metta-analyst | 1,200 |')
    expect(markdown).toContain('| haiku | 1,200 |')
  })

  it('counts two hook records sharing a key both times (hook records are never dropped)', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 100, source: 'hook' }),
        record({ task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 200, source: 'hook' }),
      ],
    })
    expect(markdown).toContain('**~300 tokens** across 2 record(s).')
    expect(markdown).toContain('| implementation | metta-executor | sonnet | 100 | hook (exact) |')
    expect(markdown).toContain('| implementation | metta-executor | sonnet | 200 | hook (exact) |')
    expect(markdown).toContain('| metta-executor | 300 |')
  })

  it('does not collapse a prose record whose task id differs from the hook record', async () => {
    const { markdown } = await gen({
      tokenUsage: [
        record({ task: 'T1', agent: 'metta-executor', model: 'sonnet', tokens: 500, source: 'prose' }),
        record({ task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 41250, source: 'hook' }),
      ],
    })
    expect(markdown).toContain('**~41,750 tokens** across 2 record(s).')
    expect(markdown).toContain('| T1 | metta-executor | sonnet | 500 | prose (estimate) |')
    expect(markdown).toContain('| implementation | metta-executor | sonnet | 41,250 | hook (exact) |')
  })

  it('does not mutate the caller tokenUsage array during generation', async () => {
    const tokenUsage = [
      record({ task: 'implementation', agent: 'metta-executor', tokens: 40000, source: 'prose' }),
      record({ task: 'implementation', agent: 'metta-executor', tokens: 41250, source: 'hook' }),
    ]
    const snapshot = structuredClone(tokenUsage)
    await gen({ tokenUsage })
    expect(tokenUsage).toEqual(snapshot)
  })

  // --- Section order ----------------------------------------------------------

  it('renders the seven sections in the pre-delta order', async () => {
    const { markdown } = await gen({ tokenUsage: [record()], artifactTimings: { intent: timing() } })
    const sections = [
      '# Token usage: test-change',
      '## Total',
      '## Per artifact',
      '## Per role',
      '## Per model',
      '## Cheap/pinned (non-inherit) vs inherit',
      '## Gaps',
    ]
    const positions = sections.map(s => markdown.indexOf(s))
    for (const pos of positions) expect(pos).toBeGreaterThan(-1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
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
