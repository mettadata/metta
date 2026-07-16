import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseConstitution, type ConstitutionArticles } from './constitution-parser.js'
import { parseComplexityTracking } from './complexity-tracking.js'
import type { Violation, ViolationList } from '../schemas/violation.js'

export interface AnnotatedViolation extends Violation {
  justified: boolean
  justification?: string
}

export interface CheckResult {
  violations: AnnotatedViolation[]
  blocking: boolean
  justifiedMap: Record<string, string>
}

export interface CheckContract {
  articles: ConstitutionArticles
  specPath: string
  specContent: string
  instructions: string
  formattedPrompt: string
}

export class VerdictValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerdictValidationError'
  }
}

function formatArticles(articles: ConstitutionArticles): string {
  const conv = articles.conventions.map(a => `- ${a}`).join('\n')
  const off = articles.offLimits.map(a => `- ${a}`).join('\n')
  return [
    '## Conventions',
    conv || '(none)',
    '',
    '## Off-Limits',
    off || '(none)',
  ].join('\n')
}

function buildUserPrompt(
  articles: ConstitutionArticles,
  specPath: string,
  specContent: string,
): string {
  return [
    '<CONSTITUTION>',
    formatArticles(articles),
    '</CONSTITUTION>',
    '',
    `<SPEC path="${specPath}">`,
    specContent,
    '</SPEC>',
    '',
    'Identify all violations of the constitution articles in the spec.',
    'Respond with the JSON object only.',
  ].join('\n')
}

export async function buildCheckContract(
  projectRoot: string,
  changeName: string,
): Promise<CheckContract> {
  const projectMdPath = join(projectRoot, 'spec', 'project.md')
  const specMdPath = join(
    projectRoot,
    'spec',
    'changes',
    changeName,
    'spec.md',
  )

  const articles = await parseConstitution(projectMdPath)
  const specContent = await readFile(specMdPath, 'utf8')

  const instructionsPath = new URL(
    '../templates/artifacts/constitution-check-instructions.md',
    import.meta.url,
  ).pathname
  const instructions = await readFile(instructionsPath, 'utf8')

  return {
    articles,
    specPath: specMdPath,
    specContent,
    instructions,
    formattedPrompt: buildUserPrompt(articles, specMdPath, specContent),
  }
}

export async function recordVerdict(
  verdict: ViolationList,
  projectRoot: string,
  changeName: string,
): Promise<CheckResult> {
  const specMdPath = join(
    projectRoot,
    'spec',
    'changes',
    changeName,
    'spec.md',
  )

  const justifiedTrackingMap = await parseComplexityTracking(specMdPath)
  const justifiedMap: Record<string, string> = {}

  const annotated: AnnotatedViolation[] = verdict.violations.map(v => {
    const trackedRationale = justifiedTrackingMap.get(v.article)
    let justified = false
    let justification: string | undefined

    if (v.severity === 'critical') {
      justified = false
    } else if (v.severity === 'major') {
      if (trackedRationale !== undefined) {
        justified = true
        justification = trackedRationale
        justifiedMap[v.article] = trackedRationale
      }
    } else {
      // minor — advisory, treat as justified for blocking purposes
      justified = true
      if (trackedRationale !== undefined) {
        justification = trackedRationale
      }
    }

    return justification !== undefined
      ? { ...v, justified, justification }
      : { ...v, justified }
  })

  const blocking = annotated.some(isBlockingViolation)

  return { violations: annotated, blocking, justifiedMap }
}

/**
 * Single source of truth for the blocking-violation predicate.
 * Critical → always blocking. Major → blocking unless justified. Minor → never blocking.
 */
export function isBlockingViolation(v: AnnotatedViolation): boolean {
  return v.severity === 'critical' || (v.severity === 'major' && !v.justified)
}
