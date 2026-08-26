import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  skillsDir,
  commandsDir,
  contextFile,
  formatSkill,
  formatContext,
  questionCapability,
} from '../src/delivery/claude-code-adapter.js'
import { installCommands } from '../src/delivery/command-installer.js'
import { workflowPrimerLong, workflowPrimerShort } from '../src/delivery/workflow-primer.js'
import type { SkillContent, ProjectContext } from '../src/delivery/tool-adapter.js'

describe('Claude Code Adapter', () => {
  it('returns correct directories', () => {
    expect(skillsDir('/project')).toBe('/project/.claude/skills')
    expect(commandsDir('/project')).toBe('/project/.claude/commands')
    expect(contextFile('/project')).toBe('/project/CLAUDE.md')
  })

  it('formats a skill with YAML frontmatter', () => {
    const skill: SkillContent = {
      name: 'metta:propose',
      description: 'Start a new change',
      argumentHint: '<description>',
      allowedTools: ['Read', 'Write', 'Bash'],
      body: 'You are starting a new change.',
    }
    const formatted = formatSkill(skill)
    expect(formatted).toContain('---')
    expect(formatted).toContain('name: metta:propose')
    expect(formatted).toContain('description: Start a new change')
    expect(formatted).toContain('argument-hint: "<description>"')
    expect(formatted).toContain('allowed-tools: [Read, Write, Bash]')
    expect(formatted).toContain('You are starting a new change.')
  })

  it('formats context with section markers', () => {
    const context: ProjectContext = {
      name: 'My Shop',
      stack: 'Next.js, Prisma',
      conventions: ['Server components by default', 'Prisma for all DB access'],
      specs: [
        { capability: 'auth', requirements: 4, status: 'approved' },
      ],
    }
    const formatted = formatContext(context)
    expect(formatted).toContain('<!-- metta:project-start')
    expect(formatted).toContain('<!-- metta:project-end -->')
    expect(formatted).toContain('**My Shop**')
    expect(formatted).toContain('Next.js, Prisma')
    expect(formatted).toContain('<!-- metta:conventions-start')
    expect(formatted).toContain('Server components by default')
    expect(formatted).toContain('<!-- metta:specs-start')
    expect(formatted).toContain('auth')
    expect(formatted).toContain('<!-- metta:workflow-start')
    expect(formatted).toContain('/metta-propose')
    expect(formatted).toContain('State-mutating metta commands MUST go through the matching metta skill')
  })

  it('reports question capability', () => {
    const cap = questionCapability()
    expect(cap.tool).toBe('AskUserQuestion')
    expect(cap.supportsOptions).toBe(true)
    expect(cap.supportsMultiSelect).toBe(true)
  })
})

describe('Workflow primer research discipline rule', () => {
  it('workflowPrimerLong declares a Research discipline subsection', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toContain('### Research discipline')
  })

  it('workflowPrimerLong cites WebFetch and WebSearch by name', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toContain('`WebFetch`')
    expect(text).toContain('`WebSearch`')
  })

  it('workflowPrimerLong scopes the rule to research/design-phase questions about external documented behavior', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toMatch(/research-phase or design-phase question/i)
    expect(text).toMatch(/external framework \/ API \/ tool documented behavior/i)
  })

  it('workflowPrimerLong only escalates subjective judgments to the user', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toMatch(/subjective judgments/i)
    expect(text).toContain('scope')
    expect(text).toContain('cost')
    expect(text).toContain('product direction')
  })

  it('workflowPrimerShort does not inline the detailed research rule', () => {
    // The detailed rule lives only in the long primer; short stays short.
    const text = workflowPrimerShort().join('\n')
    expect(text).not.toContain('### Research discipline')
  })
})

describe('Workflow primer Tier-2 trust model wording', () => {
  it('describes the session-bound re-prime lifecycle with bounded TTL + GRACE lifetime', () => {
    for (const primer of [workflowPrimerLong(), workflowPrimerShort()]) {
      const text = primer.join('\n')
      expect(text).toContain('re-primes a session-bound credential')
      expect(text).toContain('TTL + GRACE after the last mint or re-prime')
    }
  })

  it('does not carry the retired any-unexpired-credential model', () => {
    for (const primer of [workflowPrimerLong(), workflowPrimerShort()]) {
      const text = primer.join('\n')
      expect(text).not.toContain('any unexpired credential')
    }
  })
})

describe('Workflow primer scoped mandate', () => {
  // ADR-B: duplicated-literal pin (GRACE_MS precedent). A refactor that forks the shared
  // MANDATE constant between the two variants fails here.
  const SCOPED_MANDATE =
    '**State-mutating metta commands MUST go through the matching metta skill — never as direct CLI calls from an AI orchestrator session.** ' +
    'Enforcement authority is the `metta-guard-bash` PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a read-only query surface directly. ' +
    '(Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)'

  const READ_ONLY_POINTER =
    'Read-only queries (`metta status`, `metta progress`, `metta issues list`, …) are permitted directly; the guard fails closed, so attempting a query is always safe.'

  it('both variants carry the full scoped mandate byte-identically', () => {
    expect(workflowPrimerShort().join('\n')).toContain(SCOPED_MANDATE)
    expect(workflowPrimerLong().join('\n')).toContain(SCOPED_MANDATE)
  })

  it('neither variant carries the retired blanket-ban wording', () => {
    for (const primer of [workflowPrimerShort(), workflowPrimerLong()]) {
      const text = primer.join('\n')
      expect(text).not.toContain('never call the CLI directly')
      expect(text).not.toContain('any other `metta <cmd>`')
    }
  })

  it('long variant documents the read-only surface with hook authority attribution', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toContain('### Read-only queries (permitted directly)')
    expect(text).toContain('metta-guard-bash')
    expect(text).toContain('at generation time')
    expect(text).toContain('the hook, not this text, is authoritative')
    expect(text).toContain('attempt it')
    expect(text).toContain('fails closed')
  })

  it('short variant carries the read-only pointer line but not the subsection', () => {
    const text = workflowPrimerShort().join('\n')
    expect(text).toContain(READ_ONLY_POINTER)
    expect(text).not.toContain('### Read-only queries (permitted directly)')
  })

  it('preserves the doc-only-exceptions line and the stub-artifact prohibition', () => {
    const text = workflowPrimerLong().join('\n')
    expect(text).toContain('Doc-only fixes and edits to this workflow section itself are the exceptions.')
    expect(text).toContain('Artifacts must carry real content authored by the matching `metta-*` subagent.')
  })
})

describe('Workflow primer / guard allow-list seam', () => {
  // ADR-A: hand-synced enumeration hardened by extraction (ADR-4 constant-pin pattern from
  // tests/metta-guard-mint-seam.test.ts). The hook is the enforcement authority; the primer
  // enumerates its surface. Any allow/block list edit without a matching primer edit fails here.
  const repoRoot = join(import.meta.dirname, '..')
  const templateHook = readFileSync(join(repoRoot, 'src', 'templates', 'hooks', 'metta-guard-bash.mjs'), 'utf-8')
  const deployedHook = readFileSync(join(repoRoot, '.claude', 'hooks', 'metta-guard-bash.mjs'), 'utf-8')

  function sliceBlock(source: string, marker: string): string {
    const start = source.indexOf(marker)
    if (start === -1) throw new Error('declaration marker not found: ' + marker)
    const end = source.indexOf(']);', start)
    if (end === -1) throw new Error('declaration end `]);` not found for: ' + marker)
    return source.slice(start, end)
  }

  // Strip // line comments FIRST — comment prose may contain quotes or backticks;
  // stripping makes the quoted-string extraction immune to comment churn.
  function stripLineComments(block: string): string {
    return block
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//')
        return idx === -1 ? line : line.slice(0, idx)
      })
      .join('\n')
  }

  function extractSet(source: string, marker: string): string[] {
    const block = stripLineComments(sliceBlock(source, marker))
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  function extractTwoWord(source: string, marker: string): Array<[string, string[]]> {
    const block = stripLineComments(sliceBlock(source, marker))
    return [...block.matchAll(/\['([a-z-]+)',\s*new Set\(\[([^\]]+)\]\)/g)].map((m) => [
      m[1],
      [...m[2].matchAll(/'([^']+)'/g)].map((sub) => sub[1]),
    ])
  }

  function extractAll(source: string) {
    return {
      allowedSingle: extractSet(source, 'const ALLOWED_SUBCOMMANDS = new Set(['),
      allowedTwoWord: extractTwoWord(source, 'const ALLOWED_TWO_WORD = new Map(['),
      allowedBare: extractSet(source, 'const ALLOWED_BARE = new Set(['),
      blockedSingle: extractSet(source, 'const BLOCKED_SUBCOMMANDS = new Set(['),
      blockedTwoWord: extractTwoWord(source, 'const BLOCKED_TWO_WORD = new Map(['),
    }
  }

  const template = extractAll(templateHook)
  const deployed = extractAll(deployedHook)

  it('extraction meets sanity floors (regex not silently broken)', () => {
    expect(template.allowedSingle.length).toBeGreaterThanOrEqual(9)
    expect(template.allowedTwoWord.length).toBeGreaterThanOrEqual(7)
    expect(template.allowedBare.length).toBeGreaterThanOrEqual(3)
  })

  it('template and deployed hook copies carry identical lists', () => {
    expect(deployed).toEqual(template)
  })

  it('every allowed entry appears in the long primer in rendered form', () => {
    const text = workflowPrimerLong().join('\n')
    for (const word of template.allowedSingle) {
      expect(text).toContain('`' + word + '`')
    }
    for (const [group, subs] of template.allowedTwoWord) {
      expect(text).toContain('`' + group + ' ' + subs.join('|') + '`')
    }
    const bareLine = workflowPrimerLong().find((line) => line.includes('Bare (flags only)'))
    expect(bareLine).toBeDefined()
    for (const word of template.allowedBare) {
      expect(bareLine).toContain('`' + word + '`')
    }
  })

  it('every blocked entry appears in the Forbidden bullet', () => {
    const forbiddenBullet = workflowPrimerLong().find((line) =>
      line.startsWith('- Invoking any state-mutating metta command'),
    )
    expect(forbiddenBullet).toBeDefined()
    for (const word of template.blockedSingle) {
      expect(forbiddenBullet).toContain('`' + word + '`')
    }
    for (const [group, subs] of template.blockedTwoWord) {
      expect(forbiddenBullet).toContain('`' + group + ' ' + subs.join('/') + '`')
    }
  })
})

describe('installCommands', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-install-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('copies skill template files to project', async () => {
    const installed = await installCommands(tempDir)
    expect(installed.length).toBeGreaterThanOrEqual(8)
    expect(installed).toContain('metta:quick')
    expect(installed).toContain('metta:propose')

    // Verify files exist on disk
    const skillsDir = join(tempDir, '.claude', 'skills')
    const dirs = await readdir(skillsDir)
    expect(dirs).toContain('metta-quick')
    expect(dirs).toContain('metta-propose')

    // Verify content is real (not empty)
    const quickSkill = await readFile(join(skillsDir, 'metta-quick', 'SKILL.md'), 'utf-8')
    expect(quickSkill).toContain('name: metta:quick')
    expect(quickSkill).toContain('orchestrator')
  })
})
