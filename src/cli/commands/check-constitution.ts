import { Command } from 'commander'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson } from '../helpers.js'
import {
  checkConstitution,
  isBlockingViolation,
  type AnnotatedViolation,
  type CheckResult,
} from '../../constitution/checker.js'
import { AnthropicProvider } from '../../providers/anthropic-provider.js'
import { assertSafeSlug } from '../../util/slug.js'

const execAsync = promisify(execFile)

function renderViolationLine(v: AnnotatedViolation): string {
  // Preserve evidence verbatim by quoting instead of fencing — inline-code fencing
  // breaks when evidence contains backticks (reviewers flagged mutating the quote
  // corrupts the "verbatim excerpt" contract promised to the agent).
  let line = `- **[${v.severity}] ${v.article}** — evidence: "${v.evidence.replace(/"/g, '\\"')}" — suggestion: ${v.suggestion}`
  if (v.severity === 'major' && v.justified && v.justification) {
    line += ` Justified in Complexity Tracking: "${v.justification.replace(/"/g, '\\"')}".`
  }
  if (isBlockingViolation(v)) {
    line += ' **BLOCKING.**'
  }
  return line
}

function renderViolationsMd(
  changeName: string,
  result: CheckResult,
  checkedIso: string,
  specVersion: string,
): string {
  const frontmatter = ['---', `checked: ${checkedIso}`, `spec_version: ${specVersion}`, '---', '']
  if (result.violations.length === 0) {
    return [...frontmatter, 'No violations found.', ''].join('\n')
  }
  const body = [
    '# Constitution Violations',
    '',
    `## ${changeName} — ${result.violations.length} violation${result.violations.length === 1 ? '' : 's'}`,
    '',
    ...result.violations.map(renderViolationLine),
    '',
  ]
  return [...frontmatter, ...body].join('\n')
}

async function getSpecVersion(projectRoot: string, specAbsPath: string): Promise<string> {
  // Use git hash-object to hash the WORKING TREE content (the actual bytes we
  // just checked), not the committed blob. Ensures version reflects what was
  // evaluated, even when user has uncommitted edits.
  try {
    const { stdout } = await execAsync(
      'git',
      ['hash-object', specAbsPath],
      { cwd: projectRoot },
    )
    return stdout.trim().slice(0, 8) || 'unversioned'
  } catch {
    return 'unversioned'
  }
}

async function resolveChangeName(
  ctx: ReturnType<typeof createCliContext>,
  flagName?: string,
): Promise<string> {
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

export function registerCheckConstitutionCommand(program: Command): void {
  program
    .command('check-constitution')
    .description("Check a change spec.md against the project constitution")
    .option('--change <name>', 'Change name')
    .action(async (options: { change?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changeName = await resolveChangeName(ctx, options.change)
        assertSafeSlug(changeName, 'change name')
        const provider = new AnthropicProvider({ apiKeyEnv: 'ANTHROPIC_API_KEY' })

        const result = await checkConstitution({
          provider,
          projectRoot: ctx.projectRoot,
          changeName,
        })

        const specRelPath = join('spec', 'changes', changeName, 'spec.md')
        const specAbsPath = join(ctx.projectRoot, specRelPath)
        const specVersion = await getSpecVersion(ctx.projectRoot, specAbsPath)
        const checkedIso = new Date().toISOString()

        const violationsRelPath = join('spec', 'changes', changeName, 'violations.md')
        const violationsAbsPath = join(ctx.projectRoot, violationsRelPath)
        const md = renderViolationsMd(changeName, result, checkedIso, specVersion)

        await mkdir(dirname(violationsAbsPath), { recursive: true })
        await writeFile(violationsAbsPath, md, { flag: 'w' })

        if (json) {
          outputJson({
            violations: result.violations,
            blocking: result.blocking,
            violations_path: violationsRelPath,
          })
        } else {
          if (result.violations.length === 0) {
            console.log('No violations found.')
          } else {
            for (const v of result.violations) {
              const tag = isBlockingViolation(v) ? ' [BLOCKING]' : ''
              console.log(`[${v.severity}] ${v.article}${tag}`)
              console.log(`  evidence:   ${v.evidence}`)
              console.log(`  suggestion: ${v.suggestion}`)
              if (v.justification) {
                console.log(`  justified:  ${v.justification}`)
              }
            }
          }
          console.log(`\nWrote: ${violationsRelPath}`)
        }

        process.exit(result.blocking ? 4 : 0)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({
            error: { code: 4, type: 'check_constitution_error', message },
          })
        } else {
          console.error(`check-constitution failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
