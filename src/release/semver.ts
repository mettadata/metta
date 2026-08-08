import type { BumpLevel } from '../schemas/releases-record.js'

/**
 * Thrown when a version string is not in the strict `x.y.z` form.
 */
export class SemverParseError extends Error {
  constructor(public readonly input: string) {
    super(
      `Invalid version '${input}': expected the strict x.y.z form ` +
        `(three non-negative integers separated by dots, e.g. 1.4.2 — ` +
        `no 'v' prefix, prerelease, or build metadata)`,
    )
    this.name = 'SemverParseError'
  }
}

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
}

/**
 * Strict `x.y.z` only. Rejected: prerelease (`1.2.3-rc.1`), build metadata
 * (`1.2.3+abc`), a leading `v`, surrounding whitespace, missing/extra
 * components, negative or non-numeric parts.
 *
 * Leading-zeros decision: rejected (e.g. `01.2.3`), matching the semver 2.0.0
 * spec, which forbids leading zeroes in numeric identifiers. `0` itself is
 * fine.
 */
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(v: string): ParsedSemver {
  const match = STRICT_SEMVER.exec(v)
  if (match === null) {
    throw new SemverParseError(v)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

/**
 * Bumps `current` at `level`, resetting all lower components to zero:
 * major → `(x+1).0.0`, minor → `x.(y+1).0`, patch → `x.y.(z+1)`.
 * Throws {@link SemverParseError} when `current` is not strict `x.y.z`.
 */
export function bumpVersion(current: string, level: BumpLevel): string {
  const { major, minor, patch } = parseSemver(current)
  switch (level) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}
