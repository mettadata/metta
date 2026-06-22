import { Command } from 'commander'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { setProjectField } from '../../config/config-writer.js'

/**
 * Coerce a raw CLI string value to its typed form, matching the coercion
 * rules in config-loader.ts applyEnvOverrides: 'true'/'false' → boolean,
 * a clean integer → number, everything else stays a string.
 */
export function coerceValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  return value
}

/**
 * Resolve the editor binary for `config edit` from the environment:
 * $VISUAL is preferred over $EDITOR. Returns undefined (no usable editor)
 * when neither is set or both are empty/whitespace.
 */
export function resolveEditor(env: NodeJS.ProcessEnv): string | undefined {
  const candidate = env.VISUAL || env.EDITOR
  if (!candidate || candidate.trim() === '') return undefined
  return candidate
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage configuration')

  config
    .command('get')
    .argument('<key>', 'Config key (dot notation)')
    .description('Read config value')
    .action(async (key) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const cfg = await ctx.configLoader.load() as Record<string, unknown>
        const parts = key.split('.')
        let value: unknown = cfg
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[part]
          } else {
            value = undefined
            break
          }
        }
        if (json) {
          outputJson({ key, value })
        } else {
          console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'undefined'))
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'config_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  config
    .command('set')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .description('Set config value')
    .action(async (key, value) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const configPath = join(ctx.projectRoot, '.metta', 'config.yaml')
      try {
        const path = key.split('.')
        const coerced = coerceValue(value)

        // Back up the current raw bytes so we can restore on validation failure.
        let backup: string
        try {
          backup = await readFile(configPath, 'utf8')
        } catch (err) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('No .metta/config.yaml found — run metta install first.')
          }
          throw err
        }

        await setProjectField(ctx.projectRoot, path, coerced)

        // Validate-after-write: reload through ProjectConfigSchema. On failure,
        // restore the original bytes so an invalid value never stays on disk.
        ctx.configLoader.clearCache?.()
        try {
          await ctx.configLoader.load()
        } catch (validationErr) {
          await writeFile(configPath, backup, 'utf8')
          const message = getErrorMessage(validationErr)
          throw new Error(`Rejected: ${message} (config restored)`)
        }

        if (json) {
          outputJson({ key, value: coerced, status: 'set' })
        } else {
          console.log(`Set ${key} = ${coerced}`)
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'config_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  config
    .command('edit')
    .description('Open config in editor')
    .argument('[target]', 'What to edit: constitution or config')
    .action(async (target) => {
      const json = program.opts().json
      const file = target === 'constitution' ? 'spec/project.md' : '.metta/config.yaml'
      if (json) {
        outputJson({ file })
        return
      }
      const editor = resolveEditor(process.env)
      if (!editor) {
        console.error(`No editor set — set $EDITOR or $VISUAL, or edit ${file} directly.`)
        process.exit(4)
      }
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(editor, [file], { stdio: 'inherit' })
        child.on('error', (err) => {
          console.error(`Failed to launch editor '${editor}': ${err.message}`)
          resolve(4)
        })
        child.on('exit', (code) => resolve(code ?? 0))
      })
      if (exitCode !== 0) {
        process.exit(exitCode)
      }
    })
}
