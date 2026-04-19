import { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'
import { parseTasksMd, computeWaves } from '../../planning/index.js'
import { renderHumanPlan, renderJsonPlan } from './tasks-renderer.js'

type ErrorType = 'not_found' | 'cycle' | 'malformed'

function emitError(json: boolean, type: ErrorType, message: string): never {
  if (json) {
    outputJson({ error: { code: 4, type, message } })
  } else {
    console.error(message)
  }
  process.exit(4)
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command('tasks')
    .description('Inspect change task plans')

  tasks
    .command('plan')
    .description('Print a parallel wave execution plan for a change\'s tasks.md')
    .requiredOption('--change <name>', 'Change slug (directory under spec/changes)')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (options: { change: string; json?: boolean }) => {
      const json = Boolean(options.json) || Boolean(program.opts().json)
      const ctx = createCliContext()
      const tasksMdPath = join(
        ctx.projectRoot,
        'spec',
        'changes',
        options.change,
        'tasks.md',
      )

      let contents: string
      try {
        contents = await readFile(tasksMdPath, 'utf8')
      } catch (err) {
        if (isNodeError(err) && err.code === 'ENOENT') {
          emitError(json, 'not_found', `tasks.md not found: ${tasksMdPath}`)
        }
        const message = err instanceof Error ? err.message : String(err)
        emitError(json, 'malformed', `Failed to read tasks.md: ${message}`)
      }

      let graph
      try {
        graph = parseTasksMd(contents)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emitError(json, 'malformed', `Failed to parse tasks.md: ${message}`)
      }

      let plan
      try {
        plan = computeWaves(graph, options.change)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const type: ErrorType = /cycle/i.test(message) ? 'cycle' : 'malformed'
        emitError(json, type, message)
      }

      const output = json ? renderJsonPlan(plan) : renderHumanPlan(plan)
      console.log(output)
    })
}
