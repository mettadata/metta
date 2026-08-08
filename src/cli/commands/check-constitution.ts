import { Command } from 'commander'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, getErrorMessage, resolveChangeRoot } from '../helpers.js'
import {
  buildCheckContract,
  recordVerdict,
  VerdictValidationError,
  isBlockingViolation,
  type AnnotatedViolation,
  type CheckResult,
} from '../../constitution/checker.js'
import { ViolationListSchema, type ViolationList } from '../../schemas/violation.js'
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
    .option('--record <file>', 'Path to a verdict JSON file to validate and persist')
    .action(async (options: { change?: string; record?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changeName = await resolveChangeName(ctx, options.change)
        assertSafeSlug(changeName, 'change name')

        // Change-scoped paths (spec.md read, violations.md write) root at
        // the checkout hosting the change — the worktree checkout for
        // worktree-hosted changes — so a main-root-invoked session never
        // reads or writes the wrong tree. Only not-found metadata reads
        // fall back to the project root (mirrors context.ts); anything else
        // propagates. The verdict scratch file stays anchored at the
        // invoking checkout's `.metta/scratch` — it is transient session
        // state, not a change artifact.
        let changeRoot = ctx.projectRoot
        try {
          changeRoot = resolveChangeRoot(ctx.projectRoot, await ctx.artifactStore.getChange(changeName))
        } catch (err) {
          const code =
            err instanceof Error && 'code' in err
              ? (err as NodeJS.ErrnoException).code
              : undefined
          if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
          // Treat as a plain local change.
        }

        if (!options.record) {
          // Emission mode: produce the check contract for the skill/subagent.
          // Both payload paths are absolute — output_path is where the
          // orchestrator writes the verdict, spec_path is where the checked
          // spec actually lives — so consumers stay correct regardless of
          // the session's cwd.
          const contract = await buildCheckContract(changeRoot, changeName)
          const outputPath = join(ctx.projectRoot, '.metta', 'scratch', changeName, 'verdict.json')

          if (json) {
            outputJson({
              articles: contract.articles,
              spec_path: contract.specPath,
              spec_content: contract.specContent,
              verdict_schema:
                'expected shape: {"violations": [{article, severity: critical|major|minor, evidence, suggestion}]}',
              instructions: contract.instructions,
              output_path: outputPath,
              change_root: changeRoot,
            })
          } else {
            const articleCount =
              contract.articles.conventions.length + contract.articles.offLimits.length
            console.log(`Check contract for change '${changeName}':`)
            console.log(
              `  Articles: ${articleCount} (${contract.articles.conventions.length} conventions, ${contract.articles.offLimits.length} off-limits)`,
            )
            console.log(`  Spec: ${contract.specPath}`)
            console.log(
              `Record a verdict with: metta check-constitution --change ${changeName} --record <verdict-file>`,
            )
          }

          process.exit(0)
        }

        // Recording mode: validate and persist a subagent-produced verdict.
        let parsed: unknown
        try {
          parsed = JSON.parse(await readFile(options.record, 'utf8'))
        } catch (err) {
          throw new VerdictValidationError(
            `invalid verdict JSON in ${options.record}: ${getErrorMessage(err)}`,
          )
        }

        const verdictResult = ViolationListSchema.safeParse(parsed)
        if (!verdictResult.success) {
          throw new VerdictValidationError(
            `verdict file ${options.record} does not match the expected schema: ${verdictResult.error.message}`,
          )
        }
        const verdict: ViolationList = verdictResult.data

        const result = await recordVerdict(verdict, changeRoot, changeName)

        const specAbsPath = join(changeRoot, 'spec', 'changes', changeName, 'spec.md')
        const specVersion = await getSpecVersion(changeRoot, specAbsPath)
        const checkedIso = new Date().toISOString()

        const violationsAbsPath = join(changeRoot, 'spec', 'changes', changeName, 'violations.md')
        const md = renderViolationsMd(changeName, result, checkedIso, specVersion)

        await mkdir(dirname(violationsAbsPath), { recursive: true })
        await writeFile(violationsAbsPath, md, { flag: 'w' })

        if (json) {
          outputJson({
            violations: result.violations,
            blocking: result.blocking,
            violations_path: violationsAbsPath,
            change_root: changeRoot,
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
          console.log(`\nWrote: ${violationsAbsPath}`)
        }

        process.exit(result.blocking ? 4 : 0)
      } catch (err) {
        const message = getErrorMessage(err)
        const errType =
          err instanceof VerdictValidationError
            ? 'verdict_validation_error'
            : 'check_constitution_error'
        if (json) {
          outputJson({
            error: { code: 4, type: errType, message },
          })
        } else {
          console.error(`check-constitution failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
