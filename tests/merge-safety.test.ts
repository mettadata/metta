import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { MergeSafetyPipeline } from '../src/ship/merge-safety.js'

const execAsync = promisify(exec)

describe('MergeSafetyPipeline', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-ship-'))
    // Init a git repo
    await execAsync('git init', { cwd: tempDir })
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir })
    await execAsync('git config user.name "Test"', { cwd: tempDir })
    await execAsync('echo "init" > file.txt && git add . && git commit -m "init"', { cwd: tempDir })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('performs a successful merge', async () => {
    // Create a feature branch with a change
    await execAsync('git checkout -b feature', { cwd: tempDir })
    await execAsync('echo "feature" > feature.txt && git add . && git commit -m "add feature"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('feature', mainBranch)

    expect(result.status).toBe('success')
    expect(result.steps.every(s => s.status === 'pass' || s.status === 'skip')).toBe(true)
    expect(result.mergeCommit).toBeDefined()
    expect(result.snapshotTag).toBeDefined()
  })

  it('performs dry-run without merging', async () => {
    await execAsync('git checkout -b dry-feature', { cwd: tempDir })
    await execAsync('echo "dry" > dry.txt && git add . && git commit -m "dry feature"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('dry-feature', mainBranch, true)

    expect(result.status).toBe('success')
    // Merge and post-merge should be skipped
    const mergeStep = result.steps.find(s => s.step === 'merge')
    expect(mergeStep?.status).toBe('skip')
  })

  it('detects base drift', async () => {
    // Create feature branch
    await execAsync('git checkout -b drift-feature', { cwd: tempDir })
    await execAsync('echo "feature" > feature.txt && git add . && git commit -m "feature"', { cwd: tempDir })

    // Advance main
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })
    await execAsync('echo "main advance" > main.txt && git add . && git commit -m "advance main"', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('drift-feature', mainBranch)

    // Should still succeed (merge is possible even with drift)
    expect(result.status).toBe('success')
    const driftStep = result.steps.find(s => s.step === 'base-drift-check')
    expect(driftStep?.status).toBe('pass')
  })

  it('fails when source is metta/* branch with no archive', async () => {
    await execAsync('git checkout -b metta/foo', { cwd: tempDir })
    await execAsync('echo "x" > x.txt && git add . && git commit -m "x"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()
    const targetHeadBefore = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('metta/foo', mainBranch)

    expect(result.status).toBe('failure')
    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('fail')
    expect(finalizeStep?.detail).toContain('metta finalize --change foo')

    const targetHeadAfter = (await execAsync(`git rev-parse ${mainBranch}`, { cwd: tempDir })).stdout.trim()
    expect(targetHeadAfter).toBe(targetHeadBefore)
  })

  it('passes finalize-check when archive directory exists', async () => {
    await execAsync('git checkout -b metta/bar', { cwd: tempDir })
    await execAsync('echo "y" > y.txt && git add . && git commit -m "y"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    await mkdir(join(tempDir, 'spec', 'archive', '2026-04-15-bar'), { recursive: true })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('metta/bar', mainBranch)

    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('pass')
    expect(finalizeStep?.detail).toBe('2026-04-15-bar')
  })

  it('skips finalize-check on non-metta branches', async () => {
    await execAsync('git checkout -b plain-feature', { cwd: tempDir })
    await execAsync('echo "z" > z.txt && git add . && git commit -m "z"', { cwd: tempDir })
    await execAsync('git checkout main || git checkout master', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('plain-feature', mainBranch)

    const finalizeStep = result.steps.find(s => s.step === 'finalize-check')
    expect(finalizeStep?.status).toBe('skip')
    expect(result.status).toBe('success')
  })

  it('detects merge conflicts', async () => {
    // Create conflicting changes
    await execAsync('git checkout -b conflict-feature', { cwd: tempDir })
    await execAsync('echo "feature version" > file.txt && git add . && git commit -m "feature change"', { cwd: tempDir })

    await execAsync('git checkout main || git checkout master', { cwd: tempDir })
    await execAsync('echo "main version" > file.txt && git add . && git commit -m "main change"', { cwd: tempDir })

    const mainBranch = (await execAsync('git branch --show-current', { cwd: tempDir })).stdout.trim()

    const pipeline = new MergeSafetyPipeline(tempDir)
    const result = await pipeline.run('conflict-feature', mainBranch)

    expect(result.status).toBe('conflict')
    const mergeStep = result.steps.find(s => s.step === 'dry-run-merge')
    expect(mergeStep?.status).toBe('fail')
  })
})
