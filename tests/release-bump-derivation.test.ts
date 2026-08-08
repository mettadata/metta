import { describe, it, expect } from 'vitest'
import {
  parseConventionalCommit,
  deriveBump,
  type CommitInput,
} from '../src/release/bump-derivation.js'

function commit(subject: string, body = ''): CommitInput {
  return { subject, body }
}

describe('parseConventionalCommit', () => {
  it('extracts the type before a colon', () => {
    expect(parseConventionalCommit(commit('fix: resolve crash'))).toEqual({
      type: 'fix',
      breaking: false,
    })
  })

  it('extracts the type before a scope parenthesis', () => {
    expect(parseConventionalCommit(commit('feat(api): add endpoint'))).toEqual({
      type: 'feat',
      breaking: false,
    })
  })

  it('flags breaking when ! appears before the colon', () => {
    expect(parseConventionalCommit(commit('feat!: drop legacy flag'))).toEqual({
      type: 'feat',
      breaking: true,
    })
  })

  it('flags breaking with a scoped bang subject like feat(api)!:', () => {
    expect(parseConventionalCommit(commit('feat(api)!: remove v1 routes'))).toEqual({
      type: 'feat',
      breaking: true,
    })
  })

  it('flags breaking from a BREAKING CHANGE: footer in the body', () => {
    const parsed = parseConventionalCommit(
      commit('fix: tighten parser', 'Some detail.\n\nBREAKING CHANGE: strict mode now default')
    )
    expect(parsed).toEqual({ type: 'fix', breaking: true })
  })

  it('flags breaking from a BREAKING-CHANGE: footer in the body', () => {
    const parsed = parseConventionalCommit(
      commit('chore: bump deps', 'BREAKING-CHANGE: node 22 required')
    )
    expect(parsed).toEqual({ type: 'chore', breaking: true })
  })

  it('returns null type for non-conventional subjects without erroring', () => {
    expect(parseConventionalCommit(commit('Update README'))).toEqual({
      type: null,
      breaking: false,
    })
  })

  it('does not treat a bang after the colon as breaking', () => {
    expect(parseConventionalCommit(commit('fix: really! fix it'))).toEqual({
      type: 'fix',
      breaking: false,
    })
  })
})

describe('deriveBump', () => {
  it('returns patch when the set contains only fix commits', () => {
    const commits = [commit('fix: one'), commit('fix(core): two')]
    expect(deriveBump(commits)).toBe('patch')
  })

  it('returns minor when at least one feat is present and nothing breaking', () => {
    const commits = [commit('fix: one'), commit('feat: add thing'), commit('chore: tidy')]
    expect(deriveBump(commits)).toBe('minor')
  })

  it('returns major for a feat!: subject marker', () => {
    const commits = [commit('fix: one'), commit('feat!: rework config')]
    expect(deriveBump(commits)).toBe('major')
  })

  it('returns major for a BREAKING-CHANGE footer even on a fix', () => {
    const commits = [
      commit('fix: small thing', 'BREAKING-CHANGE: config key renamed'),
      commit('feat: nice addition'),
    ]
    expect(deriveBump(commits)).toBe('major')
  })

  it('breaking wins over feat in mixed sets', () => {
    const commits = [
      commit('feat: a'),
      commit('chore(deps)!: drop node 20'),
      commit('fix: b'),
    ]
    expect(deriveBump(commits)).toBe('major')
  })

  it('treats non-conventional subjects as patch-weight', () => {
    const commits = [commit('Update README'), commit('WIP stuff')]
    expect(deriveBump(commits)).toBe('patch')
  })

  it('non-conventional subjects do not suppress a feat elevation', () => {
    const commits = [commit('Update README'), commit('feat: add mode')]
    expect(deriveBump(commits)).toBe('minor')
  })

  it('returns patch for an empty commit set', () => {
    expect(deriveBump([])).toBe('patch')
  })

  it('is deterministic for identical inputs', () => {
    const commits = [
      commit('feat(api): add endpoint'),
      commit('fix: crash', 'details'),
      commit('Update README'),
    ]
    const first = deriveBump(commits)
    const second = deriveBump(commits)
    expect(first).toBe(second)
    expect(first).toBe('minor')
    // Input is not mutated
    expect(commits).toEqual([
      commit('feat(api): add endpoint'),
      commit('fix: crash', 'details'),
      commit('Update README'),
    ])
  })
})
