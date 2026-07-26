import { Command } from 'commander'
import { join } from 'node:path'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { setupChangeWorktree } from '../../util/git-worktree.js'

export function registerProposeCommand(program: Command): void {
  program
    .command('propose')
    .description('Start a new change (standard workflow)')
    .argument('<description>', 'Description of the change')
    .option('--workflow <name>', 'Workflow to use', 'standard')
    .option('--from-gap <gap>', 'Create from a gap')
    .option('--from-idea <idea>', 'Create from an idea')
    .option('--from-issue <issue>', 'Create from an issue')
    .option('--discovery <mode>', 'Discovery mode: interactive, batch, review', 'interactive')
    .option('--auto, --accept-recommended', 'auto-accept adaptive routing recommendations')
    .option(
      '--stop-after <artifact>',
      'Stop after the named planning artifact (e.g. intent, stories, spec, research, design, tasks)',
    )
    .action(async (description, options, command) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const config = await ctx.configLoader.load()
        const workflowName = options.workflow ?? config.defaults?.workflow ?? 'standard'
        const autoAccept = options.acceptRecommended === true
        const workflowLocked = command.getOptionValueSource('workflow') === 'cli'

        // Load workflow
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(workflowName, [projectWorkflows, builtinWorkflows])

        // Validate --stop-after against the resolved workflow's buildOrder.
        // Reject execution-phase ids and unknown ids BEFORE creating any change state.
        const stopAfter: string | undefined = options.stopAfter
        if (stopAfter !== undefined) {
          const planningIds = graph.buildOrder.filter(
            id => id !== 'implementation' && id !== 'verification',
          )
          const validList = planningIds.join(', ')
          if (stopAfter === 'implementation' || stopAfter === 'verification') {
            throw new Error(
              `--stop-after value '${stopAfter}' is an execution-phase artifact and is not a valid stop point. Valid values are: ${validList}.`,
            )
          }
          if (!graph.buildOrder.includes(stopAfter)) {
            throw new Error(
              `--stop-after value '${stopAfter}' is not a valid artifact id for workflow '${workflowName}'. Valid values are: ${validList}.`,
            )
          }
        }

        // Create the branch + worktree BEFORE writing any change state, so the
        // change scaffolding lands inside the worktree and the main checkout
        // never switches branches (falls back to in-place checkout on failure).
        const changeName = ctx.artifactStore.deriveChangeName(description)
        const gitSetup = await setupChangeWorktree(ctx.projectRoot, changeName, config.git)

        // In worktree mode, change state is written inside the worktree.
        const workCtx = gitSetup.worktree !== null ? createCliContext(gitSetup.worktree) : ctx

        // Create the change
        const artifactIds = graph.buildOrder
        const result = await workCtx.artifactStore.createChange(
          description,
          workflowName,
          artifactIds,
          {},
          autoAccept,
          workflowLocked,
          stopAfter,
          gitSetup.worktree ?? undefined,
        )

        if (json) {
          outputJson({
            change: result.name,
            workflow: workflowName,
            path: result.path,
            artifacts: artifactIds,
            branch: gitSetup.branch,
            worktree: gitSetup.worktree,
            stop_after: stopAfter ?? null,
            next: `Run \`metta instructions intent --json --change ${result.name}\` to get guidance`,
          })
        } else {
          console.log(`Change created: ${result.name}`)
          console.log(`  Workflow: ${workflowName}`)
          if (gitSetup.branch !== null) console.log(`  Branch: ${gitSetup.branch}`)
          if (gitSetup.worktree !== null) {
            const note = gitSetup.mode === 'reused' ? ' (reusing existing worktree)' : ''
            console.log(`  Worktree: ${gitSetup.worktree}${note}`)
          } else if (gitSetup.mode === 'fallback') {
            console.log(`  Worktree: none — fell back to in-place checkout (${gitSetup.fallbackReason})`)
          }
          console.log(`  Artifacts: ${artifactIds.join(' → ')}`)
          if (stopAfter !== undefined) {
            console.log(`  Stop after: ${stopAfter}`)
          }
          console.log('')
          console.log(`Next: metta instructions intent --change ${result.name}`)
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'propose_error', message } })
        } else {
          console.error(`Propose failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
