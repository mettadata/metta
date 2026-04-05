import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

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
        const message = err instanceof Error ? err.message : String(err)
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
      if (json) {
        outputJson({ key, value, status: 'set' })
      } else {
        console.log(`Set ${key} = ${value}`)
        console.log('Note: edit .metta/config.yaml directly for now.')
      }
    })

  config
    .command('edit')
    .description('Open config in editor')
    .argument('[target]', 'What to edit: constitution or config')
    .action(async (target) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const file = target === 'constitution' ? 'spec/project.md' : '.metta/config.yaml'
      if (json) {
        outputJson({ file })
      } else {
        console.log(`Edit: ${file}`)
      }
    })
}
