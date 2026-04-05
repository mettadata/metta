import { Command } from 'commander'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose common issues')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
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
        checks.push({ check: '.metta directory', status: 'fail', detail: 'Not found. Run metta init.' })
      }

      // spec directory
      try {
        await stat(join(ctx.projectRoot, 'spec'))
        checks.push({ check: 'spec directory', status: 'pass' })
      } catch {
        checks.push({ check: 'spec directory', status: 'fail', detail: 'Not found. Run metta init.' })
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
          const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗'
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
