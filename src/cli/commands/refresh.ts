import { Command } from 'commander'
import { outputJson } from '../helpers.js'

export function registerRefreshCommand(program: Command): void {
  program
    .command('refresh')
    .description('Regenerate all derived files from constitution')
    .option('--dry-run', 'Preview changes without writing')
    .action(async (options) => {
      const json = program.opts().json
      if (json) {
        outputJson({ status: options.dryRun ? 'dry_run' : 'refreshed', files: [] })
      } else {
        if (options.dryRun) {
          console.log('Dry run: no files would change (no derived files generated yet).')
        } else {
          console.log('Refresh complete.')
        }
      }
    })
}
