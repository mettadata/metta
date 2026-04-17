import { Command } from 'commander'
import { createCliContext, outputJson, color, agentBanner } from '../helpers.js'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseStories, StoriesParseError } from '../../specs/stories-parser.js'
import { validateFulfillsRefs } from '../../stories/story-validator.js'
import { parseSpec } from '../../specs/spec-parser.js'

const execAsync = promisify(execFile)

const MIN_CONTENT_BYTES = 200
const SUMMARY_MIN_CONTENT_BYTES = 100
const STUB_MARKERS = [
  'intent stub', 'summary stub', 'spec stub', 'research stub',
  'design stub', 'tasks stub', 'stories stub', 'architecture stub',
  'verify stub', 'domain-research stub', 'ux-spec stub',
]

export function registerCompleteCommand(program: Command): void {
  program
    .command('complete')
    .description('Mark an artifact as complete and get next steps')
    .argument('<artifact>', 'Artifact ID to mark complete')
    .option('--change <name>', 'Change name')
    .action(async (artifactId, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`)

        // Verify the artifact file exists
        const metadata = await ctx.artifactStore.getChange(changeName)
        if (!(artifactId in metadata.artifacts)) {
          throw new Error(`Artifact '${artifactId}' not in workflow. Available: ${Object.keys(metadata.artifacts).join(', ')}`)
        }

        // Look up the generates field from the workflow definition
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(metadata.workflow, [projectWorkflows, builtinWorkflows])
        const artifactDef = graph.artifacts.find(a => a.id === artifactId)
        const generates = artifactDef?.generates ?? `${artifactId}.md`

        // Skip file check for wildcard generates (implementation produces **/*) and summary.md
        const isWildcard = generates.includes('*')
        if (!isWildcard) {
          const fileExists = await ctx.artifactStore.artifactExists(changeName, generates)
          if (!fileExists) {
            throw new Error(`Artifact file '${generates}' not found in spec/changes/${changeName}/. Write the file before marking complete.`)
          }

          // Content sanity check — block stub/placeholder artifacts
          const content = await ctx.artifactStore.readArtifact(changeName, generates)
          const contentTrimmed = content.trim()
          const contentLower = contentTrimmed.toLowerCase()
          const foundStub = STUB_MARKERS.find(m => contentLower.includes(m))
          if (foundStub) {
            throw new Error(
              `Artifact '${generates}' contains placeholder text '${foundStub}'. ` +
              `Fill in real content before marking complete.`,
            )
          }
          // summary.md may legitimately be short for trivial changes; use a lower floor.
          const minBytes = generates === 'summary.md' ? SUMMARY_MIN_CONTENT_BYTES : MIN_CONTENT_BYTES
          if (contentTrimmed.length < minBytes) {
            throw new Error(
              `Artifact '${generates}' is too short (${contentTrimmed.length} bytes, min ${minBytes}). ` +
              `Fill in real content before marking complete.`,
            )
          }
          // Unfilled {change_name} in H1 heading
          const firstLine = contentTrimmed.split('\n')[0] ?? ''
          if (firstLine.startsWith('#') && firstLine.includes('{change_name}')) {
            throw new Error(
              `Artifact '${generates}' H1 heading still contains template placeholder '{change_name}'. ` +
              `Replace it with the real change name before marking complete.`,
            )
          }

          // Pre-complete stories-valid gate
          if (artifactId === 'stories') {
            const storiesPath = join(ctx.projectRoot, 'spec', 'changes', changeName, generates)
            try {
              const stories = await parseStories(storiesPath)
              const specPath = join(ctx.projectRoot, 'spec', 'changes', changeName, 'spec.md')
              if (existsSync(specPath)) {
                const spec = await parseSpec(specPath)
                const allRefs = spec.requirements.flatMap(r => r.fulfills ?? [])
                const errors = validateFulfillsRefs(allRefs, stories)
                if (errors.length > 0) {
                  throw new Error(
                    `stories.md has ${errors.length} validation error(s): ` +
                    errors.map(e => e.message).join('; '),
                  )
                }
              }
            } catch (err) {
              if (err instanceof StoriesParseError) {
                throw new Error(`stories.md parse error: ${err.message}`)
              }
              throw err
            }
          }
        }

        // Mark complete
        await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')

        // Determine next artifact
        const updatedMetadata = await ctx.artifactStore.getChange(changeName)
        const pendingArtifacts = Object.entries(updatedMetadata.artifacts)
          .filter(([_, status]) => status === 'pending' || status === 'ready')
          .map(([id]) => id)

        // Map artifact to agent name for banner
        const artifactAgentMap: Record<string, string> = {
          intent: 'proposer', spec: 'specifier', research: 'researcher',
          design: 'architect', tasks: 'planner', implementation: 'executor', verification: 'verifier',
        }

        // Mark next artifact as ready
        if (pendingArtifacts.length > 0) {
          const next = ctx.workflowEngine.getNext(graph, updatedMetadata.artifacts)

          for (const artifact of next) {
            await ctx.artifactStore.markArtifact(changeName, artifact.id, 'ready')
          }

          const nextIds = next.map(a => a.id)

          // Always print colored banner to stderr (visible even in --json mode)
          process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
          if (nextIds.length > 0) {
            const nextAgent = artifactAgentMap[nextIds[0]] ?? 'executor'
            process.stderr.write(`Next: ${agentBanner(nextAgent, nextIds.join(', '))}\n`)
          }

          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: nextIds,
              next_agent: nextIds.length > 0 ? `metta-${artifactAgentMap[nextIds[0]] ?? 'executor'}` : null,
              next_command: nextIds.length > 0 ? `metta instructions ${nextIds[0]} --json --change ${changeName}` : null,
              all_complete: false,
            })
          } else {
            console.log(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`))
            if (nextIds.length > 0) {
              const nextAgent = artifactAgentMap[nextIds[0]] ?? 'executor'
              console.log(`Next: ${agentBanner(nextAgent, nextIds.join(', '))}`)
              console.log(`Run: metta instructions ${nextIds[0]} --change ${changeName}`)
            }
          }
        } else {
          process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
          process.stderr.write(color('All artifacts complete!', 32) + '\n')

          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: [],
              next_command: `metta finalize --change ${changeName}`,
              all_complete: true,
            })
          } else {
            console.log(`Next: metta finalize --change ${changeName}`)
          }
        }
        // Auto-commit all spec changes (artifacts + .metta.yaml state)
        try {
          const changePath = join('spec', 'changes', changeName)
          await execAsync('git', ['add', changePath], { cwd: ctx.projectRoot })
          await execAsync('git', ['diff', '--cached', '--quiet'], { cwd: ctx.projectRoot }).catch(async () => {
            await execAsync('git', ['commit', '-m', `docs(${changeName}): complete ${artifactId}`], { cwd: ctx.projectRoot })
          })
        } catch {
          // Git not available or nothing to commit
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'complete_error', message } }) } else { console.error(`Complete failed: ${message}`) }
        process.exit(4)
      }
    })
}
