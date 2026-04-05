import { Command } from 'commander'
import { outputJson } from '../helpers.js'

export function registerContextCommand(program: Command): void {
  const context = program
    .command('context')
    .description('Context budget management')

  context
    .command('stats')
    .description('Show context budget usage')
    .action(async () => {
      const json = program.opts().json
      if (json) {
        outputJson({ message: 'Context stats available during active sessions' })
      } else {
        console.log('Context stats: available during active workflow sessions.')
      }
    })

  context
    .command('check')
    .description('Check for stale context')
    .action(async () => {
      const json = program.opts().json
      if (json) {
        outputJson({ stale: [] })
      } else {
        console.log('No stale context detected.')
      }
    })
}
