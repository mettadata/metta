import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillContent, CommandContent, ProjectContext, QuestionCapability } from './tool-adapter.js'
import { workflowPrimerShort } from './workflow-primer.js'

export function detect(projectRoot: string): boolean {
  return existsSync(join(projectRoot, '.claude'))
}

export function skillsDir(root: string): string {
  return join(root, '.claude', 'skills')
}

export function commandsDir(root: string): string {
  return join(root, '.claude', 'commands')
}

export function contextFile(root: string): string {
  return join(root, 'CLAUDE.md')
}

export function formatSkill(content: SkillContent): string {
  const lines = [
    '---',
    `name: ${content.name}`,
    `description: ${content.description}`,
  ]
  if (content.argumentHint) {
    lines.push(`argument-hint: "${content.argumentHint}"`)
  }
  lines.push(`allowed-tools: [${content.allowedTools.join(', ')}]`)
  lines.push('---')
  lines.push('')
  lines.push(content.body)
  return lines.join('\n')
}

export function formatCommand(content: CommandContent): string {
  return `# ${content.name}\n\n${content.description}\n\n${content.body}`
}

export function formatContext(context: ProjectContext): string {
  const sections: string[] = []

  sections.push(`<!-- metta:project-start source:spec/project.md -->`)
  sections.push(`## Project\n`)
  sections.push(`**${context.name}**`)
  if (context.stack) sections.push(`\nStack: ${context.stack}`)
  sections.push(`<!-- metta:project-end -->`)

  if (context.conventions?.length) {
    sections.push('')
    sections.push(`<!-- metta:conventions-start source:spec/project.md -->`)
    sections.push(`## Conventions\n`)
    for (const c of context.conventions) {
      sections.push(`- ${c}`)
    }
    sections.push(`<!-- metta:conventions-end -->`)
  }

  if (context.specs?.length) {
    sections.push('')
    sections.push(`<!-- metta:specs-start source:spec/specs/ -->`)
    sections.push(`## Active Specs\n`)
    sections.push('| Capability | Requirements | Status |')
    sections.push('|------------|-------------|--------|')
    for (const s of context.specs) {
      sections.push(`| ${s.capability} | ${s.requirements} | ${s.status} |`)
    }
    sections.push(`<!-- metta:specs-end -->`)
  }

  sections.push('')
  sections.push(`<!-- metta:workflow-start -->`)
  sections.push(`## Metta Workflow\n`)
  sections.push(...workflowPrimerShort())
  sections.push(`<!-- metta:workflow-end -->`)

  return sections.join('\n')
}

export function questionCapability(): QuestionCapability {
  return {
    tool: 'AskUserQuestion',
    supportsOptions: true,
    supportsMultiSelect: true,
    supportsPreview: true,
    fallback: 'freeform',
  }
}
