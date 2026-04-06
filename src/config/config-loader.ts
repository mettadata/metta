import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import YAML from 'yaml'
import { ProjectConfigSchema, type ProjectConfig } from '../schemas/project-config.js'

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = result[key]
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }
  return result
}

async function loadYamlFile(filePath: string): Promise<Record<string, unknown> | null> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
  try {
    return YAML.parse(content) as Record<string, unknown>
  } catch (err: unknown) {
    process.stderr.write(`Warning: failed to parse YAML config at ${filePath}: ${err instanceof Error ? err.message : String(err)}\n`)
    return null
  }
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config }
  const envPrefix = 'METTA_'

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(envPrefix) || value === undefined) continue
    // Use double underscore (__) as segment separator to avoid ambiguity
    // with config keys that contain single underscores (e.g., api_key_env).
    // Example: METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV → config.providers.anthropic.api_key_env
    const remainder = key.slice(envPrefix.length).toLowerCase()
    const configPath = remainder.split('__')

    let current: Record<string, unknown> = result
    for (let i = 0; i < configPath.length - 1; i++) {
      const segment = configPath[i]
      if (typeof current[segment] !== 'object' || current[segment] === null) {
        current[segment] = {}
      }
      current = current[segment] as Record<string, unknown>
    }

    const lastKey = configPath[configPath.length - 1]
    // Try to parse as number or boolean
    if (value === 'true') {
      current[lastKey] = true
    } else if (value === 'false') {
      current[lastKey] = false
    } else if (/^\d+$/.test(value)) {
      current[lastKey] = parseInt(value, 10)
    } else {
      current[lastKey] = value
    }
  }

  return result
}

export class ConfigLoader {
  private readonly projectRoot: string
  private readonly globalDir: string
  private cachedConfig: ProjectConfig | null = null

  constructor(projectRoot: string, globalDir?: string) {
    this.projectRoot = projectRoot
    this.globalDir = globalDir ?? join(homedir(), '.metta')
  }

  async load(): Promise<ProjectConfig> {
    if (this.cachedConfig) return this.cachedConfig

    // Layer 1: Global config (lowest priority)
    const globalConfig = await loadYamlFile(join(this.globalDir, 'config.yaml')) ?? {}

    // Layer 2: Project config
    const projectConfig = await loadYamlFile(join(this.projectRoot, '.metta', 'config.yaml')) ?? {}

    // Layer 3: Local config (gitignored)
    const localConfig = await loadYamlFile(join(this.projectRoot, '.metta', 'local.yaml')) ?? {}

    // Layer 4: Environment variables (highest priority)
    let merged = deepMerge(globalConfig, projectConfig)
    merged = deepMerge(merged, localConfig)
    merged = applyEnvOverrides(merged)

    const result = ProjectConfigSchema.parse(merged)
    this.cachedConfig = result
    return result
  }

  clearCache(): void {
    this.cachedConfig = null
  }

  get projectPath(): string {
    return this.projectRoot
  }

  get globalPath(): string {
    return this.globalDir
  }

  get mettaDir(): string {
    return join(this.projectRoot, '.metta')
  }

  get specDir(): string {
    return join(this.projectRoot, 'spec')
  }
}
