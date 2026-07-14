import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getCeremonyCommitRatio, getArtifactsPerSmallChange } from '../src/util/ceremony-metrics.js'

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  })
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-q', '-b', 'main'])
  git(cwd, ['config', 'user.email', 'test@example.com'])
  git(cwd, ['config', 'user.name', 'Test'])
}

function emptyCommit(cwd: string, subject: string): void {
  git(cwd, ['commit', '-q', '--allow-empty', '-m', subject])
}

function writeArchiveMetadata(
  specDir: string,
  entryName: string,
  workflow: string,
  artifactIds: string[],
): void {
  const dir = join(specDir, 'archive', entryName)
  mkdirSync(dir, { recursive: true })
  const artifacts = artifactIds.map(id => `  ${id}: complete`).join('\n')
  const yaml = [
    `workflow: ${workflow}`,
    'created: 2026-07-01T10:00:00.000Z',
    'status: complete',
    `current_artifact: ${artifactIds[artifactIds.length - 1] ?? ''}`,
    'base_versions: {}',
    'artifacts:',
    artifacts,
    '',
  ].join('\n')
  writeFileSync(join(dir, '.metta.yaml'), yaml, 'utf8')
}

describe('ceremony-metrics', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'metta-ceremony-metrics-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('getCeremonyCommitRatio', () => {
    it('classifies a mixed chore/docs/functional commit list', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: add a thing')
      emptyCommit(tmp, 'chore: tidy up')
      emptyCommit(tmp, 'docs(readme): update usage')
      emptyCommit(tmp, 'fix(core): squash a bug')
      emptyCommit(tmp, 'some unprefixed subject')

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 2, total: 5, ratio: 2 / 5 })
    })

    it('counts merge-commit subjects in total but never in the ceremony numerator', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'chore: setup')
      emptyCommit(tmp, "Merge branch 'feature' into main")

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 1, total: 2, ratio: 0.5 })
    })

    it('does not classify uppercase or non-chore/docs prefixes as ceremony', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'Chore: uppercase type is not ceremony')
      emptyCommit(tmp, 'refactor: not ceremony either')
      emptyCommit(tmp, 'docs: real ceremony')

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 1, total: 3, ratio: 1 / 3 })
    })

    it('returns null when the directory is not a git repo', async () => {
      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toBeNull()
    })

    it('returns null when the repo has no commits (git log fails)', async () => {
      initRepo(tmp)
      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toBeNull()
    })
  })

  describe('getArtifactsPerSmallChange', () => {
    it('averages artifact counts over archived quick/trivial changes only', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-quick-one', 'quick', ['intent', 'implementation', 'verification'])
      writeArchiveMetadata(tmp, '2026-07-02-trivial-one', 'trivial', ['intent', 'implementation'])
      // A standard change must be filtered out of the sample entirely.
      writeArchiveMetadata(tmp, '2026-07-03-standard-one', 'standard', ['intent', 'spec', 'design', 'tasks', 'implementation', 'verification'])

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toEqual({ mean: 2.5, sample_size: 2 })
    })

    it('skips schema-invalid archive entries instead of throwing', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-valid-quick', 'quick', ['intent', 'implementation'])
      const badDir = join(tmp, 'archive', '2026-07-02-corrupt')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, '.metta.yaml'), 'workflow: quick\nnot_a_real_field: true\n', 'utf8')
      // Directory with no .metta.yaml at all.
      mkdirSync(join(tmp, 'archive', '2026-07-03-empty-dir'), { recursive: true })

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toEqual({ mean: 2, sample_size: 1 })
    })

    it('returns null (not 0) when no archived change is quick/trivial', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-standard-only', 'standard', ['intent', 'spec', 'design'])

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toBeNull()
    })

    it('returns null when the archive directory does not exist', async () => {
      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toBeNull()
    })
  })
})
