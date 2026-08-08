import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, agentBanner, getErrorMessage, resolveChangeRoot } from '../helpers.js'
import { renderBanner } from '../../complexity/index.js'
import { loadAgentDefinition, AgentResolutionError } from '../../agents/index.js'

const execAsync = promisify(execFile)

// Context-budget tuning numbers per agent short name. These have no
// frontmatter counterpart in the agent definition files — they are loader
// budgets, not agent identity — so they stay here as a standalone literal
// (values carried over unchanged from the deleted builtin agent map).
const AGENT_CONTEXT_BUDGETS: Record<string, number> = {
  proposer: 20000,
  specifier: 40000,
  product: 20000,
  researcher: 60000,
  architect: 80000,
  planner: 40000,
  executor: 10000,
  verifier: 50000,
  reviewer: 60000,
}
const DEFAULT_CONTEXT_BUDGET = 10000

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
        // Resolves the agent definition file at runtime — the single source
        // of truth for name/persona/tools. An unresolvable agent name throws
        // AgentResolutionError, which propagates to the catch below (exit 4);
        // there is no silent fallback agent.
        const agent = await loadAgentDefinition(agentName, artifactId)

        // Change-scoped paths root at the checkout hosting the change: the
        // worktree checkout for worktree-hosted changes (so root-invoked
        // emission matches in-worktree invocation byte for byte), the project
        // root otherwise. Workflow/template/config loading above stays
        // main-root-anchored deliberately.
        const changeRoot = resolveChangeRoot(ctx.projectRoot, metadata)
        const changePath = join(changeRoot, 'spec', 'changes', changeName)
        const specDir = join(changeRoot, 'spec')

        // Single config load, reused by both model resolution and the
        // verification-context injection below.
        const cfg = await ctx.configLoader.load()

        // Precedence note (informational only): when both a named profile
        // and an explicit executor map are set, the explicit map wins
        // per-tier-key and the profile fills the rest. Never a validation
        // error, never blocking.
        if (cfg.models?.profile && cfg.models.executor) {
          const tiers = ['trivial', 'quick'] as const
          const explicitKeys = tiers.filter(t => cfg.models?.executor?.[t] !== undefined)
          const profileKeys = tiers.filter(t => cfg.models?.executor?.[t] === undefined)
          process.stderr.write(
            `Warning: models.profile and models.executor are both set — explicit executor map supplies [${explicitKeys.join(', ')}]; profile '${cfg.models.profile}' fills [${profileKeys.join(', ')}].\n`,
          )
        }

        // Rung-1 escalation ratchet: once any model_escalations record
        // exists for this artifact, every future generation resolves to
        // 'inherit' — there is no un-escalation path.
        const escalated = (metadata.model_escalations ?? []).some(r => r.task === artifactId)

        const output = await ctx.instructionGenerator.generate({
          artifact,
          changeName,
          changePath,
          workflow: metadata.workflow,
          status: metadata.artifacts[artifactId] ?? 'pending',
          specDir,
          agent: {
            ...agent,
            context_budget: AGENT_CONTEXT_BUDGETS[agentName] ?? DEFAULT_CONTEXT_BUDGET,
          },
          nextSteps: [
            `Create the ${artifactId} artifact following the template`,
            'Run `metta status --json` to confirm completion',
          ],
          modelsConfig: cfg.models,
          escalated,
        })

        // Inject verification context for the verification artifact so the
        // metta-verifier subagent receives the project's configured strategy
        // and free-form instructions from `.metta/config.yaml`. When absent,
        // both fields are emitted as `null` so the verifier can fall back to
        // its first-run / legacy-project heuristics. ConfigParseError
        // propagates to the error boundary below.
        if (artifactId === 'verification') {
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
            const updates: Parameters<typeof ctx.artifactStore.updateChange>[1] = {
              artifact_timings: timings,
              artifact_tokens: tokens,
            }
            // Denominator integrity for the escalation-rate metric: every
            // non-inherit executor resolution appends one model_runs record,
            // written here in code (not orchestrator prose) alongside the
            // existing timing/token stamps.
            const role = output.agent.name.replace(/^metta-/, '')
            if (output.agent.model !== 'inherit' && role === 'executor') {
              updates.model_runs = [
                ...(metadata.model_runs ?? []),
                {
                  task: artifactId,
                  model: output.agent.model,
                  timestamp: new Date().toISOString(),
                },
              ]
            }
            await ctx.artifactStore.updateChange(changeName, updates)
          } catch (err) {
            process.stderr.write(
              `Warning: failed to record instructions metrics for ${artifactId}: ${getErrorMessage(err)}\n`,
            )
          }

          // Durability fix: the metrics stamp above lands in the working
          // tree only, where routine executor git hygiene (`git checkout
          // -- .`, `git stash`, `git restore`) run before an atomic commit
          // can silently erase it — proven by RCA in
          // spec/issues/a-metadata-write-path-drops-the-model-runs-array-between.md.
          // Auto-commit just the change's .metta.yaml, mirroring the
          // guarded `git add` + `git diff --cached --quiet` pattern
          // complete.ts uses at its own auto-commit. Gated on git.enabled;
          // never throws — emission MUST NOT break because of this.
          if (cfg.git?.enabled !== false) {
            try {
              const mettaYamlPath = join('spec', 'changes', changeName, '.metta.yaml')
              // The commit targets the checkout hosting the change — the
              // worktree branch for worktree-hosted changes — never the main
              // checkout's index when invoked from the main root.
              await execAsync('git', ['add', mettaYamlPath], { cwd: changeRoot })
              await execAsync('git', ['diff', '--cached', '--quiet', '--', mettaYamlPath], { cwd: changeRoot }).catch(async () => {
                await execAsync(
                  'git',
                  ['commit', '-m', `chore(${changeName}): record instruction emission`, '--', mettaYamlPath],
                  { cwd: changeRoot },
                )
              })
            } catch {
              // Git not available or nothing to commit — the stamp block
              // stays best-effort end to end.
            }
          }
        }

        // The metta agent type for subagent spawning is the resolved agent's
        // real frontmatter name — no separate mapping table.
        const mettaAgent = output.agent.name

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
        const message = getErrorMessage(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'instructions_error', message } })
        } else {
          console.error(`Instructions failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
