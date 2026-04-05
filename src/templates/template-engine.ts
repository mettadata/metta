import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface TemplateContext {
  change_name?: string
  capability_name?: string
  task_id?: string
  task_description?: string
  file_list?: string
  scenario_checklist?: string
  gate_results_summary?: string
  [key: string]: string | undefined
}

export class TemplateEngine {
  private readonly searchPaths: string[]

  constructor(searchPaths: string[]) {
    this.searchPaths = searchPaths
  }

  async load(templateName: string): Promise<string> {
    for (const searchPath of this.searchPaths) {
      try {
        const filePath = join(searchPath, templateName)
        return await readFile(filePath, 'utf-8')
      } catch {
        continue
      }
    }
    throw new Error(`Template '${templateName}' not found in: ${this.searchPaths.join(', ')}`)
  }

  async render(templateName: string, context: TemplateContext): Promise<string> {
    const template = await this.load(templateName)
    return this.substitute(template, context)
  }

  substitute(template: string, context: TemplateContext): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
      return context[key] ?? match
    })
  }
}
