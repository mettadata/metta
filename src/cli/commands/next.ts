import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, color, banner } from '../helpers.js'

const execAsync = promisify(execFile)

async function detectShipCandidate(
  root: string,
  baseBranch: string,
): Promise<{ change: string; branch: string } | null> {
  let branch: string
  try {
    const { stdout } = await execAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root })
    branch = stdout.trim()
  } catch {
    return null
  }
  const match = branch.match(/^metta\/(.+)$/)
  if (!match) return null
  try {
    const { stdout } = await execAsync('git', ['rev-list', '--count', `${baseBranch}..HEAD`], { cwd: root })
    if (parseInt(stdout.trim(), 10) === 0) return null
  } catch {
    return null
  }
  return { change: match[1], branch }
}

export function registerNextCommand(program: Command): void {
  program
    .command('next')
    .description('Show the next step in the workflow')
    .option('--change <name>', 'Change name')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()

        if (changes.length === 0) {
          const config = await ctx.configLoader.load()
          const baseBranch = config.git?.pr_base ?? 'main'
          const candidate = await detectShipCandidate(ctx.projectRoot, baseBranch)
          if (candidate) {
            if (json) {
              outputJson({
                next: 'ship',
                action: 'ship',
                command: `metta ship --branch ${candidate.branch}`,
                change: candidate.change,
                branch: candidate.branch,
              })
            } else {
              console.log(banner('ship', `Ready to ship: ${candidate.change}`))
              console.log(`Next: metta ship --branch ${candidate.branch}`)
            }
            return
          }
          if (json) {
            outputJson({ next: 'propose', command: 'metta propose <description>', message: 'No active changes. Start one with metta propose.' })
          } else {
            console.log('No active changes. Start one:')
            console.log('  metta propose <description>')
            console.log('  metta quick <description>')
          }
          return
        }

        const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) {
          if (json) {
            outputJson({ changes, message: 'Multiple changes active. Specify --change <name>.' })
          } else {
            console.log('Multiple changes active:')
            for (const c of changes) console.log(`  ${c}`)
            console.log('\nSpecify: metta next --change <name>')
          }
          return
        }

        const metadata = await ctx.artifactStore.getChange(changeName)

        // Find next ready artifact
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(metadata.workflow, [projectWorkflows, builtinWorkflows])
        const nextArtifacts = ctx.workflowEngine.getNext(graph, metadata.artifacts)

        // Check if all complete
        const allComplete = Object.values(metadata.artifacts).every(s => s === 'complete' || s === 'skipped')

        if (allComplete) {
          if (json) {
            outputJson({ next: 'finalize', command: `metta finalize --change ${changeName}`, change: changeName })
          } else {
            console.log(`All artifacts complete for ${changeName}.`)
            console.log(`Next: metta finalize --change ${changeName}`)
          }
          return
        }

        if (nextArtifacts.length === 0) {
          // Something is in_progress
          const inProgress = Object.entries(metadata.artifacts).find(([_, s]) => s === 'in_progress')
          if (inProgress) {
            if (json) {
              outputJson({ next: inProgress[0], status: 'in_progress', command: `metta instructions ${inProgress[0]} --json --change ${changeName}`, change: changeName })
            } else {
              console.log(`In progress: ${color(inProgress[0], 36)}`)
              console.log(`Continue: metta instructions ${inProgress[0]} --change ${changeName}`)
            }
          }
          return
        }

        const nextId = nextArtifacts[0].id
        const nextType = nextArtifacts[0].type

        // Route to the right action
        if (nextType === 'execution') {
          if (json) {
            outputJson({ next: nextId, action: 'execute', command: `metta execute --change ${changeName}`, change: changeName })
          } else {
            console.log(banner('execute', `Ready to implement: ${changeName}`))
            console.log(`Next: metta execute --change ${changeName}`)
          }
        } else if (nextType === 'verification') {
          if (json) {
            outputJson({ next: nextId, action: 'verify', command: `metta verify --change ${changeName}`, change: changeName })
          } else {
            console.log(banner('verify', `Ready to verify: ${changeName}`))
            console.log(`Next: metta verify --change ${changeName}`)
          }
        } else {
          if (json) {
            outputJson({ next: nextId, action: 'instructions', command: `metta instructions ${nextId} --json --change ${changeName}`, change: changeName })
          } else {
            console.log(`Next artifact: ${color(nextId, 36)}`)
            console.log(`Run: metta instructions ${nextId} --change ${changeName}`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'next_error', message } }) } else { console.error(`Next failed: ${message}`) }
        process.exit(4)
      }
    })
}
