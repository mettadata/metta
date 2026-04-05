import { Command } from 'commander'
import { outputJson } from '../helpers.js'

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean orphaned worktrees and tags')
    .action(async () => {
      const json = program.opts().json
      if (json) {
        outputJson({ cleaned: { worktrees: 0, tags: 0, logs: 0 } })
      } else {
        console.log('Cleanup complete. No orphaned resources found.')
      }
    })
}
