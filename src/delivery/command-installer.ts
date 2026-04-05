import { mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolAdapter } from './tool-adapter.js'

function getBuiltinSkillsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'templates', 'skills')
}

export async function installCommands(
  adapter: ToolAdapter,
  projectRoot: string,
): Promise<string[]> {
  const installed: string[] = []

  const skillsDir = adapter.skillsDir(projectRoot)
  if (!skillsDir) return installed

  const builtinDir = getBuiltinSkillsDir()

  let skillDirs: string[]
  try {
    const entries = await readdir(builtinDir, { withFileTypes: true })
    skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return installed
  }

  for (const skillDir of skillDirs) {
    const srcPath = join(builtinDir, skillDir)
    const destPath = join(skillsDir, skillDir)

    await mkdir(destPath, { recursive: true })
    await cp(srcPath, destPath, { recursive: true })

    // Extract skill name from SKILL.md frontmatter
    try {
      const content = await readFile(join(destPath, 'SKILL.md'), 'utf-8')
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      if (nameMatch) {
        installed.push(nameMatch[1].trim())
      }
    } catch {
      installed.push(skillDir)
    }
  }

  return installed
}
