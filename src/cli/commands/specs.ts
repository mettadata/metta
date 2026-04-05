import { Command } from 'commander'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'

export function registerSpecsCommand(program: Command): void {
  const specs = program
    .command('specs')
    .description('Manage specifications')

  specs
    .command('list')
    .description('List all capabilities')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const specsDir = join(ctx.projectRoot, 'spec', 'specs')

      try {
        const entries = await readdir(specsDir, { withFileTypes: true }).catch(() => [])
        const capabilities = entries.filter(e => e.isDirectory()).map(e => e.name)

        const results = []
        for (const cap of capabilities) {
          const lockExists = await ctx.specLockManager.exists(cap)
          let info: { version?: number; status?: string; requirements?: number } = {}
          if (lockExists) {
            const lock = await ctx.specLockManager.read(cap)
            info = { version: lock.version, status: lock.status ?? 'approved', requirements: lock.requirements.length }
          }
          results.push({ capability: cap, ...info })
        }

        if (json) {
          outputJson({ specs: results })
        } else {
          if (results.length === 0) {
            console.log('No specs found. Run metta propose to create one.')
          } else {
            for (const r of results) {
              console.log(`  ${r.capability.padEnd(20)} v${r.version ?? '?'}  ${r.requirements ?? '?'} reqs  ${r.status ?? 'unknown'}`)
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'specs_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  specs
    .command('show')
    .argument('<capability>', 'Capability name')
    .description('Show current spec')
    .action(async (capability) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const specPath = join(ctx.projectRoot, 'spec', 'specs', capability, 'spec.md')

      try {
        const content = await readFile(specPath, 'utf-8')
        if (json) {
          outputJson({ capability, content })
        } else {
          console.log(content)
        }
      } catch {
        const msg = `Spec '${capability}' not found`
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: msg } }) } else { console.error(msg) }
        process.exit(4)
      }
    })

  specs
    .command('diff')
    .argument('<capability>', 'Capability name')
    .description('Show pending changes to a spec')
    .action(async (capability) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const diffs: Array<{ change: string; content: string }> = []

        for (const name of changes) {
          const hasSpec = await ctx.artifactStore.artifactExists(name, 'spec.md')
          if (hasSpec) {
            const content = await ctx.artifactStore.readArtifact(name, 'spec.md')
            if (content.includes(capability)) {
              diffs.push({ change: name, content })
            }
          }
        }

        if (json) {
          outputJson({ capability, pending_changes: diffs })
        } else {
          if (diffs.length === 0) {
            console.log(`No pending changes for ${capability}`)
          } else {
            for (const d of diffs) {
              console.log(`--- Change: ${d.change} ---`)
              console.log(d.content)
              console.log('')
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'diff_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  specs
    .command('history')
    .argument('<capability>', 'Capability name')
    .description('Show archive history for a spec')
    .action(async (capability) => {
      const json = program.opts().json
      if (json) {
        outputJson({ capability, history: [] })
      } else {
        console.log(`History for ${capability}: (none yet)`)
      }
    })

  specs
    .command('review')
    .argument('<capability>', 'Capability name')
    .description('Interactive review of a draft spec')
    .action(async (capability) => {
      const json = program.opts().json
      if (json) {
        outputJson({ capability, status: 'review_pending' })
      } else {
        console.log(`Review for ${capability}: use metta specs show ${capability} to view, then metta specs approve ${capability}`)
      }
    })

  specs
    .command('approve')
    .argument('<capability>', 'Capability name')
    .description('Mark a draft spec as approved')
    .action(async (capability) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const lock = await ctx.specLockManager.read(capability)
        lock.status = 'approved'
        await ctx.specLockManager.write(capability, lock)

        if (json) {
          outputJson({ capability, status: 'approved' })
        } else {
          console.log(`Spec '${capability}' approved.`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'approve_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
