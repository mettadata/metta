import type { BumpLevel } from '../schemas/releases-record.js'

export interface CommitInput {
  subject: string
  body: string
}

export interface ParsedCommit {
  type: string | null
  breaking: boolean
}

const CONVENTIONAL_SUBJECT = /^([a-zA-Z]+)(\([^)]*\))?(!)?:/
const BREAKING_FOOTER = /(^|\n)BREAKING[ -]CHANGE:/

/**
 * Parse a single commit into its conventional-commit type and breaking flag.
 *
 * - `type` is the prefix before `:` or `(` (e.g. `feat`, `fix`); `null` when
 *   the subject is not conventional-commit shaped.
 * - `breaking` is true when the subject carries `!` before `:` (e.g.
 *   `feat(api)!:`) or the body contains a `BREAKING CHANGE:` /
 *   `BREAKING-CHANGE:` footer.
 *
 * Pure: no I/O, deterministic for identical inputs.
 */
export function parseConventionalCommit(commit: CommitInput): ParsedCommit {
  const match = CONVENTIONAL_SUBJECT.exec(commit.subject)
  const type = match ? match[1].toLowerCase() : null
  const subjectBreaking = match ? match[3] === '!' : false
  const bodyBreaking = BREAKING_FOOTER.test(commit.body)
  return { type, breaking: subjectBreaking || bodyBreaking }
}

/**
 * Derive the recommended semver bump level from a set of commits.
 *
 * Any breaking commit → `major`; otherwise any `feat` commit → `minor`;
 * otherwise `patch`. Non-conventional subjects count as patch-weight and
 * never cause an error. An empty set yields `patch`.
 *
 * Pure: no git, filesystem, or network I/O.
 */
export function deriveBump(commits: CommitInput[]): BumpLevel {
  let sawFeat = false
  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit)
    if (parsed.breaking) {
      return 'major'
    }
    if (parsed.type === 'feat') {
      sawFeat = true
    }
  }
  return sawFeat ? 'minor' : 'patch'
}
