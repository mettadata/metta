import { mkdir, readFile, readdir, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolAdapter } from './tool-adapter.js'

function getTemplatesDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'templates')
}

export async function installCommands(
  adapter: ToolAdapter,
  projectRoot: string,
): Promise<string[]> {
  const installed: string[] = []
  const templatesDir = getTemplatesDir()

  // Install skills
  const skillsDir = adapter.skillsDir(projectRoot)
  if (skillsDir) {
    const builtinSkills = join(templatesDir, 'skills')
    try {
      const entries = await readdir(builtinSkills, { withFileTypes: true })
      const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name)

      for (const skillDir of skillDirs) {
        const srcPath = join(builtinSkills, skillDir)
        const destPath = join(skillsDir, skillDir)
        await mkdir(destPath, { recursive: true })
        await cp(srcPath, destPath, { recursive: true })

        try {
          const content = await readFile(join(destPath, 'SKILL.md'), 'utf-8')
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          if (nameMatch) installed.push(nameMatch[1].trim())
        } catch {
          installed.push(skillDir)
        }
      }
    } catch {
      // No skills directory
    }
  }

  // Install agents
  const agentsDir = join(projectRoot, '.claude', 'agents')
  const builtinAgents = join(templatesDir, 'agents')
  try {
    const entries = await readdir(builtinAgents)
    const agentFiles = entries.filter(e => e.endsWith('.md'))

    await mkdir(agentsDir, { recursive: true })
    for (const file of agentFiles) {
      await cp(join(builtinAgents, file), join(agentsDir, file))
      const name = file.replace('.md', '')
      installed.push(`agent:${name}`)
    }
  } catch {
    // No agents directory
  }

  return installed
}
