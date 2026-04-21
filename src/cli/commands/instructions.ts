import { Command } from 'commander'
import { join } from 'node:path'
import { createCliContext, outputJson, agentBanner } from '../helpers.js'
import { renderBanner } from '../../complexity/index.js'
import type { AgentDefinition } from '../../schemas/agent-definition.js'

const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
  proposer: { name: 'proposer', persona: 'You are a product-minded engineer focused on clear problem definition.', capabilities: ['propose', 'intent'], tools: ['Read', 'Grep', 'Glob'], context_budget: 20000 },
  specifier: { name: 'specifier', persona: 'You are a requirements engineer focused on completeness and testability.', capabilities: ['spec', 'requirements', 'scenarios'], tools: ['Read', 'Grep', 'Glob'], context_budget: 40000 },
  product: { name: 'product', persona: 'You are a product-thinking engineer translating engineering intent into user stories.', capabilities: ['stories', 'user-stories'], tools: ['Read', 'Write'], context_budget: 20000 },
  researcher: { name: 'researcher', persona: 'You are a technical researcher focused on evaluating implementation approaches.', capabilities: ['research', 'analysis'], tools: ['Read', 'Grep', 'Glob', 'Bash'], context_budget: 60000 },
  architect: { name: 'architect', persona: 'You are a senior systems architect focused on simplicity and maintainability.', capabilities: ['design', 'review', 'adr', 'architecture'], tools: ['Read', 'Grep', 'Glob', 'Bash'], context_budget: 80000 },
  planner: { name: 'planner', persona: 'You are a task planner focused on decomposition and dependency ordering.', capabilities: ['tasks', 'decomposition'], tools: ['Read', 'Grep', 'Glob'], context_budget: 40000 },
  executor: { name: 'executor', persona: 'You are an implementation engineer. Write clean, tested code.', capabilities: ['implementation', 'code'], tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'], context_budget: 10000 },
  verifier: { name: 'verifier', persona: 'You are a verification engineer focused on spec compliance.', capabilities: ['verification', 'testing'], tools: ['Read', 'Bash', 'Grep', 'Glob'], context_budget: 50000 },
  reviewer: { name: 'reviewer', persona: 'You are a senior code reviewer focused on quality, security, and correctness.', capabilities: ['code-review', 'quality'], tools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'], context_budget: 60000 },
}

export function registerInstructionsCommand(program: Command): void {
  program
    .command('instructions')
    .description('Get AI instructions for an artifact')
    .argument('<artifact>', 'Artifact ID')
    .option('--change <name>', 'Change name')
    .action(async (artifactId, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}`)

        const metadata = await ctx.artifactStore.getChange(changeName)

        // Advisory banner (informational only) — goes to stderr so --json stdout
        // remains machine-readable. Emitted before any other output.
        const advisory = renderBanner(metadata.complexity_score, metadata.workflow)
        if (advisory.length > 0) {
          process.stderr.write(advisory + '\n')
        }

        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(metadata.workflow, [projectWorkflows, builtinWorkflows])
        const artifact = graph.artifacts.find(a => a.id === artifactId)
        if (!artifact) throw new Error(`Artifact '${artifactId}' not found in workflow '${metadata.workflow}'`)

        const agentName = artifact.agents[0] ?? 'executor'
        const agent = BUILTIN_AGENTS[agentName] ?? BUILTIN_AGENTS.executor

        const changePath = join(ctx.projectRoot, 'spec', 'changes', changeName)
        const specDir = join(ctx.projectRoot, 'spec')

        const output = await ctx.instructionGenerator.generate({
          artifact,
          changeName,
          changePath,
          workflow: metadata.workflow,
          status: metadata.artifacts[artifactId] ?? 'pending',
          specDir,
          agent,
          nextSteps: [
            `Create the ${artifactId} artifact following the template`,
            'Run `metta status --json` to confirm completion',
          ],
        })

        // Inject verification context for the verification artifact so the
        // metta-verifier subagent receives the project's configured strategy
        // and free-form instructions from `.metta/config.yaml`. When absent,
        // both fields are emitted as `null` so the verifier can fall back to
        // its first-run / legacy-project heuristics. ConfigParseError
        // propagates to the error boundary below.
        if (artifactId === 'verification') {
          const cfg = await ctx.configLoader.load()
          const v = (cfg as Record<string, unknown>).verification as
            | { strategy?: string; instructions?: string }
            | undefined
          const ctxObj = output.context as Record<string, unknown>
          ctxObj.verification_strategy = v?.strategy ?? null
          ctxObj.verification_instructions = v?.instructions ?? null
        }

        // Best-effort stamp of `artifact_timings[id].started` (only if
        // unset) and `artifact_tokens[id]` (always overwritten with the
        // freshly-computed budget numbers). Never throws into the
        // instructions path — instrumentation MUST NOT block workflow.
        //
        // Status guard: only stamp when the artifact is still in progress
        // (`ready` or `in_progress`). Re-reading instructions for an
        // already-`complete` artifact is a pure inspection and MUST NOT
        // mutate timing/token records for the closed artifact.
        const preStatus = metadata.artifacts[artifactId]
        if (preStatus === 'ready' || preStatus === 'in_progress') {
          try {
            const timings = { ...(metadata.artifact_timings ?? {}) }
            const existingTiming = timings[artifactId] ?? {}
            if (!existingTiming.started) {
              timings[artifactId] = {
                ...existingTiming,
                started: new Date().toISOString(),
              }
            }
            const tokens = { ...(metadata.artifact_tokens ?? {}) }
            tokens[artifactId] = {
              context: output.budget.context_tokens,
              budget: output.budget.budget_tokens,
            }
            await ctx.artifactStore.updateChange(changeName, {
              artifact_timings: timings,
              artifact_tokens: tokens,
            })
          } catch (err) {
            process.stderr.write(
              `Warning: failed to record instructions metrics for ${artifactId}: ${err instanceof Error ? err.message : String(err)}\n`,
            )
          }
        }

        // Map agent name to metta agent type for subagent spawning
        const agentTypeMap: Record<string, string> = {
          proposer: 'metta-proposer', specifier: 'metta-proposer',
          product: 'metta-product',
          researcher: 'metta-researcher', architect: 'metta-architect',
          planner: 'metta-planner', executor: 'metta-executor', reviewer: 'metta-reviewer', verifier: 'metta-verifier',
        }
        const mettaAgent = agentTypeMap[agentName] ?? 'metta-executor'

        // Always print colored banner to stderr
        process.stderr.write(agentBanner(output.agent.name, `${artifactId} → ${mettaAgent}`) + '\n')

        if (json) {
          outputJson({ ...output, metta_agent: mettaAgent })
        } else {
          console.log(agentBanner(output.agent.name, `instructions for ${artifactId}`))
          console.log(`  Output: ${output.output_path}`)
          console.log(`  Budget: ${output.budget.context_tokens}/${output.budget.budget_tokens} tokens`)
          console.log('')
          console.log('Template:')
          console.log(output.template)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'instructions_error', message } })
        } else {
          console.error(`Instructions failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
