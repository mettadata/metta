import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { outputJson, color } from '../helpers.js'

const execAsync = promisify(execFile)

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update Metta framework to latest version')
    .option('--check', 'Check for updates without installing')
    .action(async (options) => {
      const json = program.opts().json

      try {
        if (options.check) {
          const { stdout } = await execAsync('npm', ['view', '@mettadata/metta', 'version'], { timeout: 10000 }).catch(() => ({ stdout: 'unknown' }))
          const latest = stdout.trim()
          const current = '0.1.0'

          if (json) {
            outputJson({ current, latest, update_available: current !== latest })
          } else {
            console.log(`Current: ${current}`)
            console.log(`Latest:  ${latest}`)
            if (current === latest) {
              console.log(color('Up to date.', 32))
            } else {
              console.log(`Run: npm install -g @mettadata/metta`)
            }
          }
          return
        }

        if (json) {
          outputJson({ status: 'updating', command: 'npm install -g @mettadata/metta' })
        } else {
          console.log('Updating Metta...')
        }

        await execAsync('npm', ['install', '-g', '@mettadata/metta'], { timeout: 60000 })

        if (json) {
          outputJson({ status: 'updated' })
        } else {
          console.log(color('Updated successfully.', 32))
          console.log('Run `metta install` in your projects to update skills and agents.')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'update_error', message } }) } else { console.error(`Update failed: ${message}`) }
        process.exit(4)
      }
    })
}
