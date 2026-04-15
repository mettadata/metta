import { Command } from 'commander'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createCliContext, outputJson, type CliContext } from '../helpers.js'
import { parseStories, StoriesParseError } from '../../specs/stories-parser.js'
import {
  validateFulfillsRefs,
  detectDrift,
  type ValidationIssue,
} from '../../stories/story-validator.js'
import { parseSpec } from '../../specs/spec-parser.js'
import { assertSafeSlug } from '../../util/slug.js'

async function resolveChangeName(ctx: CliContext, flagName?: string): Promise<string> {
  if (flagName) return flagName
  const changes = await ctx.artifactStore.listChanges()
  if (changes.length === 0) {
    throw new Error('No active changes found.')
  }
  if (changes.length > 1) {
    throw new Error(`Multiple active changes: ${changes.join(', ')}. Specify --change <name>.`)
  }
  return changes[0]
}

export function registerValidateStoriesCommand(program: Command): void {
  program
    .command('validate-stories')
    .description('Validate user stories for a change against schema and spec.md Fulfills refs')
    .option('--change <name>', 'Change name')
    .action(async (options: { change?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const changeName = await resolveChangeName(ctx, options.change)
        assertSafeSlug(changeName, 'change name')

        const storiesPath = join(ctx.projectRoot, 'spec', 'changes', changeName, 'stories.md')
        if (!existsSync(storiesPath)) {
          if (json) {
            outputJson({
              error: {
                code: 4,
                type: 'not_found',
                message: `stories.md not found at ${storiesPath}`,
              },
            })
          } else {
            console.error(`validate-stories failed: not_found — ${storiesPath}`)
          }
          process.exit(4)
          return
        }

        const stories = await parseStories(storiesPath)

        const specPath = join(ctx.projectRoot, 'spec', 'changes', changeName, 'spec.md')
        const errors: ValidationIssue[] = []
        const warnings: ValidationIssue[] = []
        if (existsSync(specPath)) {
          const spec = await parseSpec(specPath)
          const allRefs = spec.requirements.flatMap(
            (r) => ((r as unknown as { fulfills?: string[] }).fulfills ?? []) as string[],
          )
          errors.push(...validateFulfillsRefs(allRefs, stories))

          const storiesMtime = (await stat(storiesPath)).mtimeMs
          const specMtime = (await stat(specPath)).mtimeMs
          const drift = detectDrift(storiesMtime, specMtime)
          if (drift) warnings.push(drift)
        }

        const ok = errors.length === 0
        if (json) {
          const base: Record<string, unknown> = {
            ok,
            change: changeName,
            errors,
            warnings,
            drift_warning: warnings.some((w) => w.kind === 'drift'),
          }
          if (stories.kind === 'stories') {
            base.stories = stories.stories
            base.internal = false
          } else {
            base.stories = []
            base.internal = true
            base.justification = stories.justification
          }
          outputJson(base)
        } else {
          if (stories.kind === 'stories') {
            for (const s of stories.stories) {
              console.log(`${s.id}: ${s.title}`)
            }
          } else {
            console.log(`[sentinel] ${stories.justification}`)
          }
          for (const e of errors) {
            console.error(`  ERROR: ${e.message}`)
          }
          for (const w of warnings) {
            console.warn(`  WARN:  ${w.message}`)
          }
          if (ok) {
            console.log(`stories.md valid for change ${changeName}`)
          }
        }
        process.exit(ok ? 0 : 4)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const isParseErr = err instanceof StoriesParseError
        const type = isParseErr ? 'stories_parse_error' : 'validate_stories_error'
        if (json) {
          const payload: Record<string, unknown> = { code: 4, type, message }
          if (isParseErr) {
            if (err.field) payload.field = err.field
            if (err.storyId) payload.story_id = err.storyId
          }
          outputJson({ error: payload })
        } else {
          if (isParseErr) {
            const details: string[] = []
            if (err.storyId) details.push(`story=${err.storyId}`)
            if (err.field) details.push(`field=${err.field}`)
            const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
            console.error(`validate-stories failed: ${message}${suffix}`)
          } else {
            console.error(`validate-stories failed: ${message}`)
          }
        }
        process.exit(4)
      }
    })
}
