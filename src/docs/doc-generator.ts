import type { DocsConfig } from '../schemas/project-config.js'

export type DocType = 'architecture' | 'api' | 'changelog' | 'getting-started'

export const VALID_DOC_TYPES: readonly DocType[] = [
  'architecture',
  'api',
  'changelog',
  'getting-started',
] as const

export interface DocGenerateResult {
  generated: string[]
  skipped: string[]
  warnings: string[]
}

export class DocGenerator {
  constructor(
    private specDir: string,
    private projectRoot: string,
    private config: DocsConfig,
    private templateDir?: string,
  ) {}

  async generate(types?: DocType[], dryRun?: boolean): Promise<DocGenerateResult> {
    // TODO: implement in Task 1.1
    void this.specDir
    void this.projectRoot
    void this.config
    void this.templateDir
    void types
    void dryRun
    return { generated: [], skipped: [], warnings: [] }
  }
}
