import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { loadAgentDefinition } from '../src/agents/agent-registry.js'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')
const AGENTS_DIR = join(import.meta.dirname, '..', 'src', 'templates', 'agents')

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 20000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

function stripBold(text: string): string {
  return text.replace(/\*\*/g, '')
}

/** Opening paragraph of an agent file body (after frontmatter, before first heading). */
function openingParagraph(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const firstBlock = body.split(/\n\s*\n/).find(b => b.trim().length > 0) ?? ''
  return firstBlock.trim()
}

/** The `tools: [...]` frontmatter array of an agent file, as string[]. */
function frontmatterTools(content: string): string[] {
  const match = content.match(/^tools:\s*\[(.*)\]\s*$/m)
  return match ? match[1].split(',').map(t => t.trim()) : []
}

describe('metta instructions sources agent identity from agent files', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-agent-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-agent-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits persona and tools from metta-executor.md frontmatter/body, not literals', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('agent src', 'quick', ['intent', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'agent-src'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)

    const agentFile = await readFile(join(AGENTS_DIR, 'metta-executor.md'), 'utf-8')
    expect(payload.agent.name).toBe('metta-executor')
    expect(payload.agent.persona).toContain(stripBold(openingParagraph(agentFile)))
    expect(payload.agent.tools).toEqual(frontmatterTools(agentFile))
    // No `models` key in config: executor resolves to inherit even at quick tier
    expect(payload.agent.model).toBe('inherit')
    // metta_agent is the resolved agent's real frontmatter name
    expect(payload.metta_agent).toBe('metta-executor')
  })

  it('emits researcher tools from frontmatter including WebSearch/WebFetch (diverged from old literal)', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('agent research', 'standard', ['intent', 'research'])

    const result = await runCli(
      ['--json', 'instructions', 'research', '--change', 'agent-research'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)

    const agentFile = await readFile(join(AGENTS_DIR, 'metta-researcher.md'), 'utf-8')
    expect(payload.agent.name).toBe('metta-researcher')
    expect(payload.agent.tools).toEqual(frontmatterTools(agentFile))
    // The old BUILTIN_AGENTS literal was [Read, Grep, Glob, Bash] — frontmatter adds these:
    expect(payload.agent.tools).toContain('WebSearch')
    expect(payload.agent.tools).toContain('WebFetch')
    expect(payload.agent.tools).toContain('Write')
    // No `models` key in config: non-executor role resolves to inherit
    expect(payload.agent.model).toBe('inherit')
  })

  it('editing the agent definition file changes the resolved persona with no code change', async () => {
    // Temp copy of the real agents directory acts as the registry's templateDir.
    const agentsCopy = join(tempDir, 'agents-copy')
    await cp(AGENTS_DIR, agentsCopy, { recursive: true })

    const before = await loadAgentDefinition('executor', 'implementation', agentsCopy)
    expect(before.persona).toContain('implementation engineer')

    const filePath = join(agentsCopy, 'metta-executor.md')
    const content = await readFile(filePath, 'utf-8')
    const edited = content.replace(
      'You are an **implementation engineer**. Write clean, tested code.',
      'You are a **rewritten implementation engineer**. Ship boldly.',
    )
    expect(edited).not.toBe(content)
    await writeFile(filePath, edited)

    const after = await loadAgentDefinition('executor', 'implementation', agentsCopy)
    expect(after.persona).not.toBe(before.persona)
    expect(after.persona).toContain('rewritten implementation engineer')
    expect(after.persona).toContain('Ship boldly.')
  })

  it('exits 4 with a JSON error naming agent and artifact when the workflow assigns a nonexistent agent', async () => {
    await mkdir(join(tempDir, '.metta', 'workflows'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'workflows', 'quick.yaml'),
      [
        'name: quick',
        'description: fixture quick workflow with an unresolvable agent',
        'version: 1',
        '',
        'artifacts:',
        '  - id: intent',
        '    type: intent',
        '    template: intent.md',
        '    generates: intent.md',
        '    requires: []',
        '    agents: [nonexistent-agent]',
        '    gates: []',
        '',
      ].join('\n'),
    )
    const store = new ArtifactStore(specDir)
    await store.createChange('phantom agent', 'quick', ['intent'])

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'phantom-agent'],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error.message).toContain('nonexistent-agent')
    expect(payload.error.message).toContain('intent')
  })

  it('resolves specifier end-to-end to the real metta-specifier agent (not metta-proposer)', async () => {
    await mkdir(join(tempDir, '.metta', 'workflows'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'workflows', 'quick.yaml'),
      [
        'name: quick',
        'description: fixture quick workflow assigning the specifier agent',
        'version: 1',
        '',
        'artifacts:',
        '  - id: intent',
        '    type: intent',
        '    template: intent.md',
        '    generates: intent.md',
        '    requires: []',
        '    agents: [specifier]',
        '    gates: []',
        '',
      ].join('\n'),
    )
    const store = new ArtifactStore(specDir)
    await store.createChange('real specifier', 'quick', ['intent'])

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'real-specifier'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.agent.name).toBe('metta-specifier')
    expect(payload.metta_agent).toBe('metta-specifier')
    expect(payload.agent.persona).toContain(
      'requirements engineer focused on completeness and testability',
    )
    expect(payload.agent.tools).toEqual(['Read', 'Write', 'Grep', 'Glob'])
    expect(payload.agent.model).toBe('inherit')
  })

  it('resolves implementation agent.model to sonnet under budget profile at quick tier', async () => {
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-agent-test\nmodels:\n  profile: budget\n',
    )
    const store = new ArtifactStore(specDir)
    await store.createChange('budget quick', 'quick', ['intent', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'budget-quick'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.agent.name).toBe('metta-executor')
    // budget profile expansion: quick-tier executor runs on sonnet
    expect(payload.agent.model).toBe('sonnet')
  })

  it('resolves implementation agent.model to inherit under budget profile at standard tier', async () => {
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-agent-test\nmodels:\n  profile: budget\n',
    )
    const store = new ArtifactStore(specDir)
    await store.createChange('budget standard', 'standard', ['intent', 'spec', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'budget-standard'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.agent.name).toBe('metta-executor')
    // executor routing is tier-coupled: standard tier never downgrades
    expect(payload.agent.model).toBe('inherit')
  })

  it('resolves non-executor artifacts to inherit under budget profile at every tier', async () => {
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-agent-test\nmodels:\n  profile: budget\n',
    )
    const store = new ArtifactStore(specDir)
    await store.createChange('budget planning quick', 'quick', ['intent', 'implementation'])
    await store.createChange('budget planning standard', 'standard', ['intent', 'spec'])

    // intent (proposer) at quick tier — planning cohort, hard inherit
    const intentResult = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'budget-planning-quick'],
      tempDir,
    )
    expect(intentResult.code).toBe(0)
    const intentPayload = JSON.parse(intentResult.stdout)
    expect(intentPayload.agent.name).toBe('metta-proposer')
    expect(intentPayload.agent.model).toBe('inherit')

    // spec (specifier) at standard tier — planning cohort, hard inherit
    const specResult = await runCli(
      ['--json', 'instructions', 'spec', '--change', 'budget-planning-standard'],
      tempDir,
    )
    expect(specResult.code).toBe(0)
    const specPayload = JSON.parse(specResult.stdout)
    expect(specPayload.agent.name).toBe('metta-specifier')
    expect(specPayload.agent.model).toBe('inherit')
  })
})
