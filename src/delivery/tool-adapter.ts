export interface SkillContent {
  name: string
  description: string
  argumentHint?: string
  allowedTools: string[]
  body: string
}

export interface CommandContent {
  name: string
  description: string
  body: string
}

export interface ProjectContext {
  name: string
  stack?: string
  conventions?: string[]
  specs?: Array<{ capability: string; requirements: number; status: string }>
  gaps?: string[]
}

export interface QuestionCapability {
  tool: string
  supportsOptions: boolean
  supportsMultiSelect: boolean
  supportsPreview: boolean
  fallback: 'freeform'
}

export interface ToolAdapter {
  id: string
  name: string
  detect(projectRoot: string): boolean
  skillsDir(root: string): string | null
  commandsDir(root: string): string | null
  contextFile(root: string): string | null
  formatSkill(content: SkillContent): string
  formatCommand(content: CommandContent): string
  formatContext(context: ProjectContext): string
  questionCapability(): QuestionCapability
}
