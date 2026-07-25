import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { setupChangeWorktree, type WorktreeGitConfig } from '../../util/git-worktree.js'

export function registerQuickCommand(program: Command): void {
  program
    .command('quick')
    .description('Quick mode — skip planning, small changes')
    .argument('<description>', 'Description of the change')
    .option('--auto, --accept-recommended', 'auto-accept adaptive routing recommendations')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const autoAccept = options.acceptRecommended === true

      try {
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const graph = await ctx.workflowEngine.loadWorkflow('quick', [builtinWorkflows])

        // Config is only needed for the git section; an unreadable config must
        // not fail quick (mirrors the historical swallow-and-continue behavior).
        let gitConfig: WorktreeGitConfig | undefined
        try {
          gitConfig = (await ctx.configLoader.load()).git
        } catch {
          // Proceed with defaults
        }

        // Create the branch + worktree BEFORE writing any change state, so the
        // change scaffolding lands inside the worktree and the main checkout
        // never switches branches (falls back to in-place checkout on failure).
        const changeName = ctx.artifactStore.deriveChangeName(description)
        const gitSetup = await setupChangeWorktree(ctx.projectRoot, changeName, gitConfig)

        // In worktree mode, change state is written inside the worktree.
        const workCtx = gitSetup.worktree !== null ? createCliContext(gitSetup.worktree) : ctx

        const artifactIds = graph.buildOrder
        const result = await workCtx.artifactStore.createChange(
          description,
          'quick',
          artifactIds,
          {},
          autoAccept,
          undefined,
          undefined,
          gitSetup.worktree ?? undefined,
        )

        if (json) {
          outputJson({
            change: result.name,
            workflow: 'quick',
            path: result.path,
            artifacts: artifactIds,
            branch: gitSetup.branch,
            worktree: gitSetup.worktree,
          })
        } else {
          console.log(`Quick change created: ${result.name}`)
          if (gitSetup.branch !== null) console.log(`  Branch: ${gitSetup.branch}`)
          if (gitSetup.worktree !== null) {
            const note = gitSetup.mode === 'reused' ? ' (reusing existing worktree)' : ''
            console.log(`  Worktree: ${gitSetup.worktree}${note}`)
          } else if (gitSetup.mode === 'fallback') {
            console.log(`  Worktree: none — fell back to in-place checkout (${gitSetup.fallbackReason})`)
          }
          console.log(`  Artifacts: ${artifactIds.join(' → ')}`)
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'quick_error', message } })
        } else {
          console.error(`Quick failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
