import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { WorktreeManager, HeadAdvancedError } from '../src/execution/worktree-manager.js'

const execAsync = promisify(exec)

describe('WorktreeManager', () => {
  let tempDir: string
  let manager: WorktreeManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-worktree-'))
    await execAsync('git init', { cwd: tempDir })
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir })
    await execAsync('git config user.name "Test"', { cwd: tempDir })
    await writeFile(join(tempDir, 'init.txt'), 'init')
    await execAsync('git add . && git commit -m "init"', { cwd: tempDir })
    manager = new WorktreeManager(tempDir)
  })

  afterEach(async () => {
    // Clean up any worktrees before removing tempDir
    try {
      await manager.cleanup()
    } catch {
      // best effort
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('merge base commit check', () => {
    it('merges cleanly when HEAD has not advanced', async () => {
      const wt = await manager.create('test-change', 'task-1')

      // Make a change in the worktree
      await writeFile(join(wt.path, 'new-file.txt'), 'worktree content')
      await execAsync('git add . && git commit -m "worktree commit"', { cwd: wt.path })

      const result = await manager.merge(wt)

      expect(result.status).toBe('clean')
      expect(result.changedFiles).toContain('new-file.txt')

      await manager.remove(wt)
    })

    it('rebases and merges when HEAD has advanced with no conflicts', async () => {
      const wt = await manager.create('test-change', 'task-2')

      // Make a change in the worktree (different file)
      await writeFile(join(wt.path, 'worktree-file.txt'), 'worktree content')
      await execAsync('git add . && git commit -m "worktree commit"', { cwd: wt.path })

      // Advance HEAD in the main repo (different file, no conflict)
      await writeFile(join(tempDir, 'main-file.txt'), 'main content')
      await execAsync('git add . && git commit -m "advance main"', { cwd: tempDir })

      // Verify HEAD has actually advanced
      const currentHead = await manager.resolveHead()
      expect(currentHead).not.toBe(wt.baseCommit)

      const result = await manager.merge(wt)

      expect(result.status).toBe('clean')
      expect(result.changedFiles).toContain('worktree-file.txt')

      await manager.remove(wt)
    })

    it('throws HeadAdvancedError when rebase fails due to conflicts', async () => {
      const wt = await manager.create('test-change', 'task-3')

      // Make a change in the worktree to the same file
      await writeFile(join(wt.path, 'init.txt'), 'worktree version')
      await execAsync('git add . && git commit -m "worktree change"', { cwd: wt.path })

      // Advance HEAD with a conflicting change to the same file
      await writeFile(join(tempDir, 'init.txt'), 'main version')
      await execAsync('git add . && git commit -m "conflicting main change"', { cwd: tempDir })

      await expect(manager.merge(wt)).rejects.toThrow(HeadAdvancedError)

      await manager.remove(wt)
    })

    it('HeadAdvancedError contains useful diagnostic info', async () => {
      const wt = await manager.create('test-change', 'task-4')

      await writeFile(join(wt.path, 'init.txt'), 'worktree version')
      await execAsync('git add . && git commit -m "worktree change"', { cwd: wt.path })

      await writeFile(join(tempDir, 'init.txt'), 'main version')
      await execAsync('git add . && git commit -m "conflicting main change"', { cwd: tempDir })

      try {
        await manager.merge(wt)
        expect.fail('Should have thrown HeadAdvancedError')
      } catch (err) {
        expect(err).toBeInstanceOf(HeadAdvancedError)
        const headErr = err as HeadAdvancedError
        expect(headErr.baseCommit).toBe(wt.baseCommit)
        expect(headErr.currentHead).not.toBe(wt.baseCommit)
        expect(headErr.branch).toBe(wt.branch)
        expect(headErr.message).toContain('HEAD has advanced')
        expect(headErr.message).toContain('Rebase failed')
      }

      await manager.remove(wt)
    })

    it('handles sequential merges where each merge advances HEAD', async () => {
      // Simulate the parallel execution merge pattern: two worktrees
      // created at the same base, merged sequentially
      const wt1 = await manager.create('test-change', 'task-5a')
      const wt2 = await manager.create('test-change', 'task-5b')

      // Both worktrees modify different files
      await writeFile(join(wt1.path, 'file-a.txt'), 'content a')
      await execAsync('git add . && git commit -m "task a"', { cwd: wt1.path })

      await writeFile(join(wt2.path, 'file-b.txt'), 'content b')
      await execAsync('git add . && git commit -m "task b"', { cwd: wt2.path })

      // Merge first worktree -- HEAD matches baseCommit, clean merge
      const result1 = await manager.merge(wt1)
      expect(result1.status).toBe('clean')

      // Now HEAD has advanced due to the merge commit.
      // Merge second worktree -- HEAD differs from baseCommit,
      // should rebase and merge cleanly.
      const result2 = await manager.merge(wt2)
      expect(result2.status).toBe('clean')

      await manager.remove(wt1)
      await manager.remove(wt2)
    })
  })
})
