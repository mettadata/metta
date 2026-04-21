import { Command } from 'commander'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { autoCommitFile, createCliContext, outputJson, color } from '../helpers.js'
import { repairProjectConfig } from '../../config/repair-config.js'

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose common issues')
    .option('--fix', 'Repair duplicate keys and schema-invalid entries in .metta/config.yaml')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      if (options.fix) {
        const configPath = join(ctx.projectRoot, '.metta', 'config.yaml')
        let source: string
        try {
          source = await readFile(configPath, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            if (json) {
              outputJson({ repair: { status: 'no_config' } })
            } else {
              console.log('No .metta/config.yaml found — nothing to repair.')
            }
            return
          }
          throw err
        }

        const result = repairProjectConfig(source)

        if (!result.changed) {
          if (json) {
            outputJson({
              repair: {
                status: 'clean',
                duplicates_removed: [],
                invalid_keys_removed: [],
                committed: false,
              },
            })
          } else {
            console.log('.metta/config.yaml is already valid — no changes needed.')
          }
          return
        }

        await writeFile(configPath, result.source, 'utf8')
        const commit = await autoCommitFile(
          ctx.projectRoot,
          configPath,
          'chore: metta doctor repaired .metta/config.yaml',
        )

        if (json) {
          outputJson({
            repair: {
              status: 'repaired',
              duplicates_removed: result.duplicatesRemoved,
              invalid_keys_removed: result.invalidKeysRemoved,
              committed: commit.committed,
              commit_sha: commit.sha ?? null,
            },
          })
        } else {
          for (const entry of result.duplicatesRemoved) {
            console.log(`  - ${entry}`)
          }
          for (const entry of result.invalidKeysRemoved) {
            console.log(`  - ${entry}`)
          }
          if (commit.committed) {
            console.log(`  Committed: ${commit.sha?.slice(0, 7)}`)
          } else if (commit.reason) {
            console.log(`  Not committed: ${commit.reason}`)
          }
        }
        return
      }

      const checks: Array<{ check: string; status: 'pass' | 'fail' | 'warn'; detail?: string }> = []

      // Node.js version
      const nodeVersion = process.version
      const major = parseInt(nodeVersion.slice(1).split('.')[0])
      checks.push({
        check: 'Node.js version',
        status: major >= 22 ? 'pass' : 'fail',
        detail: nodeVersion,
      })

      // Framework version
      checks.push({ check: 'Framework version', status: 'pass', detail: '0.1.0' })

      // .metta directory
      try {
        await stat(join(ctx.projectRoot, '.metta'))
        checks.push({ check: '.metta directory', status: 'pass' })
      } catch {
        checks.push({ check: '.metta directory', status: 'fail', detail: 'Not found. Run metta install.' })
      }

      // spec directory
      try {
        await stat(join(ctx.projectRoot, 'spec'))
        checks.push({ check: 'spec directory', status: 'pass' })
      } catch {
        checks.push({ check: 'spec directory', status: 'fail', detail: 'Not found. Run metta install.' })
      }

      // Constitution
      try {
        await stat(join(ctx.projectRoot, 'spec', 'project.md'))
        checks.push({ check: 'Project constitution', status: 'pass' })
      } catch {
        checks.push({ check: 'Project constitution', status: 'warn', detail: 'spec/project.md not found' })
      }

      // Git
      try {
        await stat(join(ctx.projectRoot, '.git'))
        checks.push({ check: 'Git repository', status: 'pass' })
      } catch {
        checks.push({ check: 'Git repository', status: 'warn', detail: 'No git repo. Worktree isolation unavailable.' })
      }

      // State file integrity
      try {
        const stateExists = await ctx.stateStore.exists('state.yaml')
        if (stateExists) {
          const { StateFileSchema } = await import('../../schemas/state-file.js')
          await ctx.stateStore.read('state.yaml', StateFileSchema)
          checks.push({ check: 'State file integrity', status: 'pass' })
        } else {
          checks.push({ check: 'State file integrity', status: 'pass', detail: 'No state file (clean)' })
        }
      } catch {
        checks.push({ check: 'State file integrity', status: 'fail', detail: 'state.yaml failed schema validation' })
      }

      if (json) {
        outputJson({ checks })
      } else {
        for (const c of checks) {
          const icon = c.status === 'pass' ? color('✓', 32) : c.status === 'warn' ? color('⚠', 33) : color('✗', 31)
          const detail = c.detail ? ` (${c.detail})` : ''
          console.log(`  ${icon} ${c.check}${detail}`)
        }
        const failed = checks.filter(c => c.status === 'fail')
        if (failed.length > 0) {
          console.log(`\n${failed.length} issue(s) found.`)
        } else {
          console.log('\nAll checks passed.')
        }
      }
    })
}
