import { Command } from 'commander'
import { join } from 'node:path'
import { createCliContext, handleError, outputJson } from '../helpers.js'
import { DocGenerator, VALID_DOC_TYPES } from '../../docs/doc-generator.js'
import type { DocType } from '../../docs/doc-generator.js'
import { DocsConfigSchema } from '../../schemas/project-config.js'

export function registerDocsCommand(program: Command): void {
  const docs = program
    .command('docs')
    .description('Generate and manage documentation')

  docs
    .command('generate')
    .argument('[type]', 'Doc type: architecture, api, changelog, getting-started')
    .option('--dry-run', 'Preview without writing files')
    .description('Generate documentation from spec sources')
    .action(async (type: string | undefined, opts: { dryRun?: boolean }) => {
      const json = program.opts().json
      const dryRun = opts.dryRun ?? false

      try {
        // Validate type if provided
        if (type !== undefined && !VALID_DOC_TYPES.includes(type as DocType)) {
          const msg = `Unknown doc type '${type}'. Valid types: ${VALID_DOC_TYPES.join(', ')}`
          if (json) {
            outputJson({ error: { code: 4, type: 'validation_error', message: msg } })
          } else {
            console.error(msg)
          }
          process.exit(4)
        }

        const ctx = createCliContext()
        const projectConfig = await ctx.configLoader.load()
        const docsConfig = DocsConfigSchema.parse(projectConfig.docs ?? {})

        const specDir = join(ctx.projectRoot, 'spec')
        const templateDir = new URL('../../templates/docs', import.meta.url).pathname

        const generator = new DocGenerator(specDir, ctx.projectRoot, docsConfig, templateDir)
        const types = type ? [type as DocType] : undefined
        const result = await generator.generate(types, dryRun)

        if (json) {
          outputJson(result)
        } else {
          if (dryRun) {
            console.log('Dry run — files that would be generated:')
          }
          for (const path of result.generated) {
            console.log(path)
          }
          for (const warning of result.warnings) {
            console.error(`warn: ${warning}`)
          }
          if (result.skipped.length > 0) {
            console.error(`Skipped: ${result.skipped.join(', ')}`)
          }
        }
      } catch (err) {
        handleError(err, json)
      }
    })
}
