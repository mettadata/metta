import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseStatusPayload,
  parseChangeMetadataYaml,
  findWorktreeActivity,
} from '../src/templates/statusline/statusline.mjs'

describe('parseStatusPayload', () => {
  it('parses the single-change shape', () => {
    expect(
      parseStatusPayload({
        change: 'my-change',
        current_artifact: 'implementation',
        workflow: 'quick',
      }),
    ).toEqual({ artifact: 'implementation', slug: 'my-change', workflow: 'quick' })
  })

  it('returns null for the zero-change shape', () => {
    expect(parseStatusPayload({ changes: [], message: 'No active changes' })).toBeNull()
  })

  it('picks the first active change from the multi-change shape', () => {
    expect(
      parseStatusPayload({
        changes: [
          { change: 'done-change', current_artifact: 'verification', status: 'complete', workflow: 'standard' },
          { change: 'live-change', current_artifact: 'tasks', status: 'active', workflow: 'standard' },
        ],
      }),
    ).toEqual({ artifact: 'tasks', slug: 'live-change', workflow: 'standard' })
  })

  it('returns null when no change in the array is active with an artifact', () => {
    expect(
      parseStatusPayload({
        changes: [{ change: 'x', status: 'complete', current_artifact: 'verification' }],
      }),
    ).toBeNull()
    expect(parseStatusPayload({ changes: [{ change: 'x', status: 'active' }] })).toBeNull()
  })

  it('tolerates junk shapes without throwing', () => {
    expect(parseStatusPayload(null)).toBeNull()
    expect(parseStatusPayload('idle')).toBeNull()
    expect(parseStatusPayload({ changes: 'nope' })).toBeNull()
    expect(parseStatusPayload({ changes: [null, 42, 'x'] })).toBeNull()
    expect(parseStatusPayload({ current_artifact: '' })).toBeNull()
  })

  it('normalizes missing slug and workflow to null', () => {
    expect(parseStatusPayload({ current_artifact: 'spec' })).toEqual({
      artifact: 'spec',
      slug: null,
      workflow: null,
    })
  })
})

describe('parseChangeMetadataYaml', () => {
  const yaml = [
    'workflow: quick',
    'created: 2026-08-11T02:22:51.429Z',
    'status: active',
    'current_artifact: implementation',
    'artifacts:',
    '  intent: complete',
    '  implementation: ready',
    '',
  ].join('\n')

  it('extracts top-level scalars', () => {
    expect(parseChangeMetadataYaml(yaml)).toEqual({
      status: 'active',
      current_artifact: 'implementation',
      workflow: 'quick',
    })
  })

  it('does not match indented (nested) keys', () => {
    const nestedOnly = 'artifacts:\n  status: complete\n  current_artifact: fake\n'
    expect(parseChangeMetadataYaml(nestedOnly)).toEqual({
      status: null,
      current_artifact: null,
      workflow: null,
    })
  })

  it('returns nulls for empty input', () => {
    expect(parseChangeMetadataYaml('')).toEqual({ status: null, current_artifact: null, workflow: null })
  })
})

describe('findWorktreeActivity', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'statusline-activity-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function writeWorktreeChange(slug: string, yaml: string): Promise<void> {
    const changeDir = join(root, '.metta', 'worktrees', slug, 'spec', 'changes', slug)
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, '.metta.yaml'), yaml, 'utf8')
  }

  it('finds an active worktree-hosted change', async () => {
    await writeWorktreeChange('my-fix', 'workflow: quick\nstatus: active\ncurrent_artifact: implementation\n')
    expect(await findWorktreeActivity(root)).toEqual({
      artifact: 'implementation',
      slug: 'my-fix',
      workflow: 'quick',
    })
  })

  it('skips non-active changes', async () => {
    await writeWorktreeChange('done-fix', 'workflow: quick\nstatus: complete\ncurrent_artifact: verification\n')
    expect(await findWorktreeActivity(root)).toBeNull()
  })

  it('returns null when no worktrees directory exists', async () => {
    expect(await findWorktreeActivity(root)).toBeNull()
  })

  it('skips worktrees without readable change metadata', async () => {
    await mkdir(join(root, '.metta', 'worktrees', 'empty-tree'), { recursive: true })
    await writeWorktreeChange('real-fix', 'workflow: standard\nstatus: active\ncurrent_artifact: tasks\n')
    expect(await findWorktreeActivity(root)).toEqual({
      artifact: 'tasks',
      slug: 'real-fix',
      workflow: 'standard',
    })
  })
})
