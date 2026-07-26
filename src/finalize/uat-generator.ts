import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Heading, Text, InlineCode, List, ListItem } from 'mdast'
import { parseStories } from '../specs/stories-parser.js'
import { parseDeltaSpec, type ParsedDelta } from '../specs/spec-parser.js'
import { TemplateEngine } from '../templates/template-engine.js'
import { getErrorMessage } from '../util/errors.js'
import type { GateResult } from '../schemas/gate-result.js'
import type { Story, StoriesDocument } from '../schemas/story.js'

export interface UatGeneratorInput {
  changeName: string
  changeDir: string
  /** 'YYYY-MM-DD', injected by the caller — the generator MUST NOT read the clock. */
  generatedAt: string
  /** Step-4 in-memory gate results (gates.yaml does not exist on disk yet). */
  gates: GateResult[]
  gatesPassed: boolean
}

export type UatTier = 'stories' | 'spec' | 'intent-summary' | 'floor'

export interface UatGeneratorResult {
  markdown: string
  tier: UatTier
  warnings: string[]
}

const TIER_DISPLAY: Record<UatTier, string> = {
  stories: 'user stories (stories.md)',
  spec: 'spec scenarios (spec.md)',
  'intent-summary': 'intent + summary (reduced)',
  floor: 'floor script (no structured sources)',
}

// --- Internal document model -------------------------------------------------

interface UatStep {
  title?: string
  setup?: string
  doText: string
  observe: string
  machineVerified?: string
}

interface UatGroup {
  heading: string
  preamble?: string
  trace?: string
  steps: UatStep[]
}

// --- Pure helpers ------------------------------------------------------------

/** Lowercase, strip backticks and `**`, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const COMMAND_SPAN_RE = /`([^`\n]+)`/g
const COMMAND_FILTER_RE = /^[A-Za-z][\w./-]*(?:\s+\S+)+$/
/** Shell metacharacters that disqualify a span from being an endorsed `(Run: ...)` hint. */
const COMMAND_METACHAR_RE = /[|;&><$`]/

/** Backtick-span command extraction: multi-token, word-ish first token only, no shell metacharacters. */
function extractCommands(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(COMMAND_SPAN_RE)) {
    const span = m[1].trim()
    if (COMMAND_METACHAR_RE.test(span)) continue
    if (COMMAND_FILTER_RE.test(span) && !out.includes(span)) out.push(span)
  }
  return out
}

function withRunHints(text: string, cmds: string[]): string {
  if (cmds.length === 0) return text
  return `${text} (Run: ${cmds.map(c => `\`${c}\``).join(', ')})`
}

const ROLE_RE = /^(GIVEN|WHEN|THEN|AND)\b\s*/i
const NO_OBSERVABLE = '(no explicit observable stated — confirm the scenario description holds)'

interface SplitSteps {
  setup?: string
  doText: string
  observe: string
}

/** GIVEN/WHEN/THEN/AND role split; AND and unprefixed steps inherit the preceding role. */
function splitScenarioSteps(steps: string[]): SplitSteps {
  const buckets: Record<'given' | 'when' | 'then', string[]> = { given: [], when: [], then: [] }
  let role: 'given' | 'when' | 'then' = 'given'
  for (const raw of steps) {
    const m = raw.match(ROLE_RE)
    let text = raw
    if (m) {
      const keyword = m[1].toUpperCase()
      if (keyword === 'GIVEN') role = 'given'
      else if (keyword === 'WHEN') role = 'when'
      else if (keyword === 'THEN') role = 'then'
      // AND inherits the preceding role
      text = raw.slice(m[0].length)
    }
    const trimmed = text.trim()
    if (trimmed) buckets[role].push(trimmed)
  }
  return {
    setup: buckets.given.length > 0 ? buckets.given.join('; ') : undefined,
    doText: buckets.when.length > 0 ? buckets.when.join('; ') : '(no explicit action stated)',
    observe: buckets.then.length > 0 ? buckets.then.join('; ') : NO_OBSERVABLE,
  }
}

// --- Machine-verified annotation ----------------------------------------------

interface AnnotationContext {
  normSummary: string
  rawSummaryLines: string[]
  gatesOk: boolean
  gateNames: string
}

const VERIFY_CONTEXT_RE = /verif|test|pass|green|covered|✓|check/i

function evidenceString(ctx: AnnotationContext, reference: string): string {
  return `summary.md references "${reference}"; gates all passed (${ctx.gateNames})`
}

/** Clauses 1+2: normalized summary contains scenario or requirement name (≥15-char floor). */
function annotateScenarioStep(
  ctx: AnnotationContext,
  scenarioName: string,
  requirementName: string,
): string | undefined {
  if (!ctx.gatesOk) return undefined
  const scenarioNorm = norm(scenarioName)
  if (scenarioNorm.length >= 15 && ctx.normSummary.includes(scenarioNorm)) {
    return evidenceString(ctx, scenarioName)
  }
  const requirementNorm = norm(requirementName)
  if (requirementNorm.length >= 15 && ctx.normSummary.includes(requirementNorm)) {
    return evidenceString(ctx, requirementName)
  }
  return undefined
}

/** Clause 3: raw summary line mentions the story id in a verification context. */
function annotateAcStep(ctx: AnnotationContext, storyId: string): string | undefined {
  if (!ctx.gatesOk) return undefined
  const idRe = new RegExp(`\\b${storyId}\\b`)
  for (const line of ctx.rawSummaryLines) {
    if (idRe.test(line) && VERIFY_CONTEXT_RE.test(line)) return evidenceString(ctx, storyId)
  }
  return undefined
}

// --- Markdown extraction (intent / summary) ------------------------------------

function parseMarkdownNodes(markdown: string): Content[] {
  return (unified().use(remarkParse).parse(markdown) as Root).children as Content[]
}

function mdText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
  if ('children' in node) {
    return (node.children as Content[]).map(mdText).join('')
  }
  return ''
}

function listItemText(item: ListItem): string {
  const paragraphs = (item.children as Content[]).filter(c => c.type === 'paragraph')
  const joined = paragraphs.map(mdText).join(' ').trim()
  if (joined) return joined
  return (item.children as Content[]).map(mdText).join(' ').trim()
}

/** intent.md `## Proposal` extraction: top-level list items, else H3 titles, else paragraphs (cap 10). */
function extractProposalBullets(markdown: string): string[] {
  const children = parseMarkdownNodes(markdown)
  const start = children.findIndex(
    n => n.type === 'heading'
      && (n as Heading).depth === 2
      && mdText(n).trim().toLowerCase() === 'proposal',
  )
  if (start === -1) return []
  const section: Content[] = []
  for (let i = start + 1; i < children.length; i++) {
    const node = children[i]
    if (node.type === 'heading' && (node as Heading).depth <= 2) break
    section.push(node)
  }
  const listItems: string[] = []
  for (const node of section) {
    if (node.type === 'list') {
      for (const item of (node as List).children as ListItem[]) {
        const text = listItemText(item)
        if (text) listItems.push(text)
      }
    }
  }
  if (listItems.length > 0) return listItems
  const h3Titles = section
    .filter(n => n.type === 'heading' && (n as Heading).depth === 3)
    .map(n => mdText(n).trim())
    .filter(t => t.length > 0)
  if (h3Titles.length > 0) return h3Titles
  return section
    .filter(n => n.type === 'paragraph')
    .map(n => mdText(n).trim())
    .filter(t => t.length > 0)
    .slice(0, 10)
}

const HIGHLIGHT_H2_RE = /what changed|changes|behavior|files changed|checks?/i

interface SummaryHighlights {
  preamble?: string
  bullets: string[]
}

/** summary.md highlights: lead paragraph after the H1 + list items under the first matching H2 (cap 10). */
function extractSummaryHighlights(markdown: string): SummaryHighlights {
  const children = parseMarkdownNodes(markdown)
  let preamble: string | undefined
  const h1Index = children.findIndex(n => n.type === 'heading' && (n as Heading).depth === 1)
  for (let i = h1Index + 1; i < children.length; i++) {
    const node = children[i]
    if (node.type === 'paragraph') {
      const text = mdText(node).trim()
      if (text) {
        preamble = text
        break
      }
    }
  }
  let bullets: string[] = []
  const h2Index = children.findIndex(
    n => n.type === 'heading' && (n as Heading).depth === 2 && HIGHLIGHT_H2_RE.test(mdText(n)),
  )
  if (h2Index !== -1) {
    for (let i = h2Index + 1; i < children.length; i++) {
      const node = children[i]
      if (node.type === 'heading' && (node as Heading).depth <= 2) break
      if (node.type === 'list') {
        for (const item of (node as List).children as ListItem[]) bullets.push(listItemText(item))
      }
    }
  }
  if (bullets.length === 0) {
    const firstList = children.find(n => n.type === 'list')
    if (firstList) {
      for (const item of (firstList as List).children as ListItem[]) bullets.push(listItemText(item))
    }
  }
  bullets = bullets.map(b => b.trim()).filter(b => b.length > 0).slice(0, 10)
  return { preamble, bullets }
}

// --- Tier assemblers -----------------------------------------------------------

function storyNumber(id: string): number {
  return parseInt(id.slice(3), 10)
}

/** Tier 1: one step per acceptance criterion, delta scenarios folded in via `fulfills`. */
function assembleFromStories(
  stories: Story[],
  deltas: ParsedDelta[],
  ctx: AnnotationContext,
): UatGroup[] {
  const groups: UatGroup[] = []
  const acNormsByStory = new Map<string, string[]>()
  const storyIds = new Set(stories.map(s => s.id))

  for (const story of stories) {
    const steps: UatStep[] = []
    const acNorms: string[] = []
    let anyAcCommand = false
    for (const ac of story.acceptanceCriteria) {
      const commands = extractCommands(`${ac.given} ${ac.when} ${ac.then}`).slice(0, 2)
      if (commands.length > 0) anyAcCommand = true
      steps.push({
        setup: ac.given,
        doText: withRunHints(ac.when, commands),
        observe: ac.then,
        machineVerified: annotateAcStep(ctx, story.id),
      })
      acNorms.push(norm(`${ac.when} ${ac.then}`))
    }
    if (!anyAcCommand) {
      const itcCommands = extractCommands(story.independentTestCriteria).slice(0, 2)
      if (itcCommands.length > 0) {
        steps[0] = {
          ...steps[0],
          doText: withRunHints(story.acceptanceCriteria[0].when, itcCommands),
        }
      }
    }
    acNormsByStory.set(story.id, acNorms)
    groups.push({
      heading: `### ${story.id}: ${story.title}`,
      preamble: `*Independent test:* ${story.independentTestCriteria}`,
      steps,
    })
  }

  const dangling: UatStep[] = []
  for (const delta of deltas) {
    if (delta.operation === 'REMOVED') continue
    const requirement = delta.requirement
    for (const scenario of requirement.scenarios) {
      const split = splitScenarioSteps(scenario.steps)
      const commands = extractCommands(scenario.steps.join(' ')).slice(0, 2)
      const step: UatStep = {
        title: scenario.name,
        setup: split.setup,
        doText: withRunHints(split.doText, commands),
        observe: split.observe,
        machineVerified: annotateScenarioStep(ctx, scenario.name, requirement.name),
      }
      const targets = requirement.fulfills.filter(id => storyIds.has(id))
      if (targets.length === 0) {
        dangling.push(step)
        continue
      }
      const target = [...targets].sort((a, b) => storyNumber(a) - storyNumber(b))[0]
      const scenarioNorm = norm(`${split.doText} ${split.observe}`)
      if ((acNormsByStory.get(target) ?? []).includes(scenarioNorm)) continue // exact-normalized dedupe
      const groupIndex = stories.findIndex(s => s.id === target)
      groups[groupIndex].steps.push(step)
    }
  }
  if (dangling.length > 0) {
    groups.push({ heading: '## Additional scenarios', steps: dangling })
  }
  return groups
}

/** Tier 2: reduced script grouped by non-REMOVED delta requirement, document order. */
function assembleFromSpec(deltas: ParsedDelta[], ctx: AnnotationContext): UatGroup[] {
  const groups: UatGroup[] = []
  for (const delta of deltas) {
    if (delta.operation === 'REMOVED') continue
    const requirement = delta.requirement
    if (requirement.scenarios.length === 0) continue
    const steps: UatStep[] = requirement.scenarios.map(scenario => {
      const split = splitScenarioSteps(scenario.steps)
      const commands = extractCommands(scenario.steps.join(' ')).slice(0, 2)
      return {
        title: scenario.name,
        setup: split.setup,
        doText: withRunHints(split.doText, commands),
        observe: split.observe,
        machineVerified: annotateScenarioStep(ctx, scenario.name, requirement.name),
      }
    })
    groups.push({
      heading: `### ${requirement.name}`,
      trace: requirement.fulfills.length > 0 ? `*Fulfills: ${requirement.fulfills.join(', ')}*` : undefined,
      steps,
    })
  }
  return groups
}

function confirmationStep(text: string): UatStep {
  return { doText: `Confirm: ${text}`, observe: 'behaves as described' }
}

/** Tier 3: confirmation prompts from intent Proposal bullets + summary highlights. */
function assembleFromIntentSummary(
  intentBullets: string[],
  summary: SummaryHighlights,
): UatGroup[] {
  const groups: UatGroup[] = []
  if (intentBullets.length > 0) {
    groups.push({ heading: '### Intent proposal', steps: intentBullets.map(confirmationStep) })
  }
  if (summary.bullets.length > 0 || summary.preamble) {
    groups.push({
      heading: '### Summary highlights',
      preamble: summary.preamble,
      steps: summary.bullets.map(confirmationStep),
    })
  }
  return groups
}

/** Floor: one generic confirmation step — a UAT.md always exists on the success path. */
function assembleFloor(): UatGroup[] {
  return [{
    heading: '### Manual review',
    steps: [{
      doText: 'Review the archived change artifacts and confirm the described behavior works',
      observe: 'behaves as described',
    }],
  }]
}

// --- Rendering -----------------------------------------------------------------

/**
 * Collapse embedded newlines (and the whitespace around them) to a single space.
 * Source text (AC/scenario fields, story/requirement names) can carry soft-break
 * newlines; emitting them verbatim onto a single markdown field line would let a
 * crafted continuation line materialize as real document structure (a heading, a
 * checkbox, a forged machine-verified annotation, a fake Generation-notes section)
 * in this "do not edit" trust artifact. Every string renderGroups emits onto a
 * field line is flattened through this choke point first.
 */
function flattenField(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ')
}

function renderGroups(groups: UatGroup[], leadIn?: string): string {
  const lines: string[] = []
  if (leadIn) lines.push(leadIn, '')
  groups.forEach((group, groupIndex) => {
    lines.push(group.heading, '')
    if (group.preamble) lines.push(flattenField(group.preamble), '')
    if (group.trace) lines.push(flattenField(group.trace), '')
    group.steps.forEach((step, stepIndex) => {
      const title = step.title ? `: ${flattenField(step.title)}` : ''
      const label = `#### Step ${groupIndex + 1}.${stepIndex + 1}${title}`
      lines.push(label)
      if (step.setup) lines.push(`- **Setup**: ${flattenField(step.setup)}`)
      lines.push(`- **Do**: ${flattenField(step.doText)}`)
      lines.push(`- **Observe**: ${flattenField(step.observe)}`)
      if (step.machineVerified) lines.push(`- **Machine-verified** — ${step.machineVerified}`)
      lines.push('- [ ] Pass', '')
    })
  })
  return lines.join('\n').trimEnd()
}

function withGenerationNotes(body: string, warnings: string[]): string {
  if (warnings.length === 0) return body
  return `${body}\n\n### Generation notes\n\n${warnings.map(w => `- ${w}`).join('\n')}`
}

// --- Orchestration ---------------------------------------------------------------

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Generate the UAT.md document for a change. Deterministic, read-only over the
 * change dir, never calls an AI provider, never reads the clock. Source problems
 * warn-and-demote through the tier ladder; only template load/render failures reject.
 */
export async function generateUat(input: UatGeneratorInput): Promise<UatGeneratorResult> {
  const warnings: string[] = []

  const summaryRaw = await readOptional(join(input.changeDir, 'summary.md'))
  const ctx: AnnotationContext = {
    normSummary: norm(summaryRaw ?? ''),
    rawSummaryLines: summaryRaw !== null ? summaryRaw.split(/\r?\n/) : [],
    gatesOk: input.gates.length > 0 && input.gatesPassed,
    gateNames: input.gates.map(g => g.gate).join(', '),
  }

  // spec.md is read once — used for tier-1 delta folding and for tier 2.
  let specRaw: string | null = null
  let specReadError: string | null = null
  try {
    specRaw = await readFile(join(input.changeDir, 'spec.md'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Warn-and-demote discipline: surface the read failure immediately so it
      // lands in Generation notes even when tier 1 proceeds without delta folding.
      specReadError = `spec.md could not be read (${getErrorMessage(err)})`
      warnings.push(specReadError)
    }
  }
  const deltas = specRaw !== null ? parseDeltaSpec(specRaw).deltas : []
  const liveScenarioCount = deltas
    .filter(d => d.operation !== 'REMOVED')
    .reduce((count, d) => count + d.requirement.scenarios.length, 0)

  // Tier 1: stories.md. Discriminate "missing file" (demote silently) from a
  // genuine parse failure (warn) structurally via an existsSync probe, rather
  // than matching StoriesParseError's message text — a wording change in the
  // parser, or a real error whose message happens to contain "not found",
  // must not change which branch this takes.
  const storiesPath = join(input.changeDir, 'stories.md')
  let storiesDoc: StoriesDocument | null = null
  if (existsSync(storiesPath)) {
    try {
      storiesDoc = await parseStories(storiesPath)
    } catch (err) {
      warnings.push(`stories.md failed to parse (${getErrorMessage(err)}); demoting to the next available tier`)
    }
  }

  let tier: UatTier
  let body: string
  if (storiesDoc !== null && storiesDoc.kind === 'stories') {
    tier = 'stories'
    body = renderGroups(assembleFromStories(storiesDoc.stories, deltas, ctx))
  } else if (specRaw !== null && liveScenarioCount > 0) {
    // Tier 2 acceptance is content-based: parseDeltaSpec never throws.
    tier = 'spec'
    body = renderGroups(assembleFromSpec(deltas, ctx))
  } else {
    // The spec.md read-failure warning (if any) was already pushed unconditionally
    // above; avoid a second, destination-presuming warning for the same failure.
    if (specReadError === null && specRaw !== null && liveScenarioCount === 0) {
      warnings.push('spec.md present but contains no scenarios; falling back to intent/summary')
    }
    // Tier 3: intent Proposal + summary highlights (annotation structurally skipped).
    const intentRaw = await readOptional(join(input.changeDir, 'intent.md'))
    const intentBullets = intentRaw !== null ? extractProposalBullets(intentRaw) : []
    const summaryHighlights: SummaryHighlights =
      summaryRaw !== null ? extractSummaryHighlights(summaryRaw) : { bullets: [] }
    const totalSteps = intentBullets.length + summaryHighlights.bullets.length
    if (totalSteps > 0) {
      tier = 'intent-summary'
      if (intentBullets.length === 0) {
        warnings.push('intent.md Proposal yielded no content; reduced script uses summary highlights only')
      }
      if (summaryHighlights.bullets.length === 0 && !summaryHighlights.preamble) {
        warnings.push('summary.md yielded no highlights; reduced script uses intent Proposal only')
      }
      body = renderGroups(
        assembleFromIntentSummary(intentBullets, summaryHighlights),
        '*Reduced script — derived from intent/summary; steps are confirmation prompts.*',
      )
    } else {
      tier = 'floor'
      warnings.push(
        'no structured sources available (stories, spec scenarios, intent proposal, summary highlights); emitting floor script',
      )
      body = renderGroups(assembleFloor())
    }
  }

  body = withGenerationNotes(body, warnings)

  const engine = new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])
  const markdown = await engine.render('uat.md', {
    change_name: input.changeName,
    generated_date: input.generatedAt,
    source_tier: TIER_DISPLAY[tier],
    uat_steps: body,
  })

  return { markdown, tier, warnings }
}
