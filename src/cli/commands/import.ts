import { Command } from 'commander'
import { stat, readdir } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { createCliContext, outputJson, color } from '../helpers.js'

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import existing code into metta specs with gap reports')
    .argument('[target]', 'Directory to import (use "." for entire project)')
    .option('--all', 'Alias for "metta import ."')
    .option('--by-module', 'Generate one spec per top-level module/directory')
    .option('--dry-run', 'Preview what would be generated without writing')
    .action(async (target, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        // Resolve target
        let scanPath: string
        if (options.all || target === '.') {
          scanPath = ctx.projectRoot
        } else if (target) {
          scanPath = resolve(ctx.projectRoot, target)
        } else {
          if (json) {
            outputJson({ error: { code: 4, type: 'missing_arg', message: 'Specify a directory or use "." for entire project. Example: metta import .' } })
          } else {
            console.error('Usage:')
            console.error('  metta import .              # Import entire project')
            console.error('  metta import src/auth       # Import a specific directory')
            console.error('  metta import . --by-module  # One spec per top-level module')
          }
          process.exit(4)
        }

        // Verify path exists
        try {
          const s = await stat(scanPath)
          if (!s.isDirectory()) throw new Error('Not a directory')
        } catch {
          const msg = `Path not found: ${scanPath}`
          if (json) { outputJson({ error: { code: 4, type: 'path_error', message: msg } }) } else { console.error(msg) }
          process.exit(4)
        }

        // Always detect modules for parallel scanning
        const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.metta', '.claude', '.git', 'spec', 'static', 'public'])
        const entries = await readdir(scanPath, { withFileTypes: true })
        const modules = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
          .map(e => e.name)

        const relativeScanPath = relative(ctx.projectRoot, scanPath) || '.'

        const result = {
          mode: modules.length > 1 ? 'parallel' : 'single',
          scan_path: relativeScanPath,
          absolute_path: scanPath,
          modules,
          output_paths: {
            specs: 'spec/specs',
            gaps: 'spec/gaps',
          },
          dry_run: !!options.dryRun,
          instructions: {
            agent_type: 'metta-researcher',
            task: modules.length > 1
              ? `Spawn one metta-researcher per module IN PARALLEL: ${modules.join(', ')}`
              : `Scan "${relativeScanPath}" and generate specs by detected capability boundaries`,
            steps: [
              `Read all source files in: ${relativeScanPath}`,
              'For each logical capability/module:',
              '  - Extract: exports, functions, types, models, routes, tests',
              '  - Write spec draft: spec/specs/<capability>/spec.md',
              '  - Use RFC 2119 keywords (MUST/SHOULD/MAY) and Given/When/Then scenarios',
              '  - Check for existing tests → extract scenarios from test descriptions',
              'Run reconciliation:',
              '  - For each requirement: does code implement it?',
              '  - For each behavior in code: is it documented in a spec?',
              '  - Write gap files to spec/gaps/ for mismatches',
              'Write spec.lock for each capability with content hashes',
              'Git commit: git add spec/ && git commit -m "docs: import specs from <path>"',
            ],
          },
        }

        if (json) {
          outputJson(result)
        } else {
          console.log(color('Import:', 36) + ` ${relativeScanPath}`)
          console.log(`  Mode: ${modules.length > 1 ? `parallel (${modules.length} modules)` : 'single'}`)
          if (modules.length > 0) {
            console.log(`  Modules: ${modules.join(', ')}`)
          }
          console.log(`  Specs → spec/specs/`)
          console.log(`  Gaps  → spec/gaps/`)
          if (options.dryRun) {
            console.log(color('\n  [dry-run] No files will be written.', 90))
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'import_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
