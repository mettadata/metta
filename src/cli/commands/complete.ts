import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'
import { join } from 'node:path'

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

        const generates = artifactId === 'implementation' ? 'summary.md' : `${artifactId}.md`
        const fileExists = await ctx.artifactStore.artifactExists(changeName, generates)
        if (!fileExists && artifactId !== 'implementation') {
          throw new Error(`Artifact file '${generates}' not found in spec/changes/${changeName}/. Write the file before marking complete.`)
        }

        // Mark complete
        await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')

        // Determine next artifact
        const updatedMetadata = await ctx.artifactStore.getChange(changeName)
        const pendingArtifacts = Object.entries(updatedMetadata.artifacts)
          .filter(([_, status]) => status === 'pending' || status === 'ready')
          .map(([id]) => id)

        // Mark next artifact as ready
        if (pendingArtifacts.length > 0) {
          // Load workflow to check dependencies
          const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
          const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
          const graph = await ctx.workflowEngine.loadWorkflow(metadata.workflow, [projectWorkflows, builtinWorkflows])
          const next = ctx.workflowEngine.getNext(graph, updatedMetadata.artifacts)

          for (const artifact of next) {
            await ctx.artifactStore.markArtifact(changeName, artifact.id, 'ready')
          }

          const nextIds = next.map(a => a.id)

          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: nextIds,
              next_command: nextIds.length > 0 ? `metta instructions ${nextIds[0]} --json --change ${changeName}` : null,
              all_complete: false,
            })
          } else {
            console.log(`✓ ${artifactId} marked complete`)
            if (nextIds.length > 0) {
              console.log(`Next: ${nextIds.join(', ')}`)
              console.log(`Run: metta instructions ${nextIds[0]} --change ${changeName}`)
            }
          }
        } else {
          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: [],
              next_command: `metta finalize --change ${changeName}`,
              all_complete: true,
            })
          } else {
            console.log(`✓ ${artifactId} marked complete`)
            console.log('All artifacts complete!')
            console.log(`Next: metta finalize --change ${changeName}`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'complete_error', message } }) } else { console.error(`Complete failed: ${message}`) }
        process.exit(4)
      }
    })
}
