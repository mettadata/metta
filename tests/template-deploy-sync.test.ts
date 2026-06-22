import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

// Template families that have a COMMITTED `.claude/` deployed copy which must
// stay byte-identical to its `src/templates/` source. These are the families at
// risk of SILENT drift: an edit to the template that is not propagated to the
// deployed copy ships a stale agent/skill/hook (see the resolved issue
// `metta-verifier-deployed-agent-copy-drifted-from-template` — the deployed
// metta-verifier agent drifted and went undetected for weeks).
//
// Workflows/gates/artifacts/docs are intentionally EXCLUDED: they are copied to
// `dist/templates/` by the build (`copy-templates`) and have no separately
// committed deployed copy, so they cannot drift this way.
//
// This test AUTO-DISCOVERS every file in each source family (rather than listing
// a hand-maintained subset), so coverage can never silently regress.
const FAMILIES = [
  { name: 'agents', src: 'src/templates/agents', deployed: '.claude/agents' },
  { name: 'skills', src: 'src/templates/skills', deployed: '.claude/skills' },
  { name: 'hooks', src: 'src/templates/hooks', deployed: '.claude/hooks' },
  { name: 'statusline', src: 'src/templates/statusline', deployed: '.claude/statusline' },
]

// Recursively list files under `dir` (absolute), returning paths relative to it.
// Synchronous so the file list is available at test-collection time.
function listFilesSync(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

describe('template deploy byte-identity', () => {
  for (const fam of FAMILIES) {
    const srcDir = join(REPO_ROOT, fam.src)
    const deployedDir = join(REPO_ROOT, fam.deployed)
    const srcFiles = listFilesSync(srcDir)

    // Guard against a misconfigured family path (e.g. a renamed directory)
    // silently producing zero assertions.
    it(`${fam.name}: source family is non-empty`, () => {
      expect(srcFiles.length).toBeGreaterThan(0)
    })

    // 1. Every source template has a byte-identical deployed copy.
    for (const rel of srcFiles) {
      it(`${fam.name}/${rel} — source and deployed copy are byte-identical`, async () => {
        const deployedPath = join(deployedDir, rel)
        expect(
          existsSync(deployedPath),
          `deployed copy missing: ${fam.deployed}/${rel} — sync the .claude copy with its template`,
        ).toBe(true)
        const source = await readFile(join(srcDir, rel), 'utf8')
        const deployed = await readFile(deployedPath, 'utf8')
        expect(deployed).toBe(source)
      })
    }

    // 2. No orphan deployed files (every deployed file maps to a source template).
    // Catches a template that was removed but whose deployed copy lingers.
    it(`${fam.name}: no orphan deployed files without a source template`, () => {
      const deployedFiles = listFilesSync(deployedDir)
      const srcSet = new Set(srcFiles)
      const orphans = deployedFiles.filter((f) => !srcSet.has(f))
      expect(orphans, `orphan deployed files in ${fam.deployed} with no source template`).toEqual([])
    })
  }
})
