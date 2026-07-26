import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import { setProjectField } from './config-writer.js'

/** A detected mismatch between the stamped and running versions. */
export interface VersionDrift {
  installed: string
  running: string
}

/**
 * Pure. Exact string inequality — no semver logic (spec: invocation-time-drift-check).
 * Returns null when the stamp is absent (legacy install) or when versions match.
 */
export function detectVersionDrift(
  installedVersion: string | undefined,
  runningVersion: string,
): VersionDrift | null {
  if (installedVersion === undefined) return null
  if (installedVersion === runningVersion) return null
  return { installed: installedVersion, running: runningVersion }
}

/**
 * Untrusted input flows from the stamp into terminal output (stderr warnings,
 * doctor detail) and JSON, so bound the charset and length at this single
 * read boundary: version-like strings only (letters, digits, `.`, `+`, `-`),
 * 1–64 chars. Rejects ANSI/OSC escape sequences, newlines, empty strings, and
 * oversized payloads by treating the stamp as absent.
 */
const VALID_STAMP = /^[0-9A-Za-z.+-]{1,64}$/

/**
 * Tolerant reader — never throws. Reads ONLY <root>/.metta/config.yaml raw
 * (no ConfigLoader: no global ~/.metta/config.yaml layer, no local.yaml, no
 * METTA_* env overrides — see ADR-1). Returns the top-level installed_version
 * when it is a string matching VALID_STAMP; returns undefined on missing
 * file, unreadable file, unparseable YAML, non-object document, absent field,
 * non-string value, or a string outside the bounded charset/length.
 */
export async function readInstalledVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(root, '.metta', 'config.yaml'), 'utf8')
    const doc: unknown = YAML.parse(raw)
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined
    const value = (doc as Record<string, unknown>).installed_version
    return typeof value === 'string' && VALID_STAMP.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Imperative shell. Writes the top-level installed_version field via the
 * validated, comment-preserving setProjectField path. Propagates errors
 * (including ENOENT when config.yaml does not exist) to the caller —
 * install/init own their error handling.
 */
export async function stampInstalledVersion(root: string, version: string): Promise<void> {
  await setProjectField(root, ['installed_version'], version)
}

/**
 * Pure. Doctor semantics differ from the invocation check: a MISSING stamp
 * warns here but stays silent at invocation time (spec: doctor-template-
 * freshness-check vs invocation-time-drift-check) — which is why this is a
 * separate function rather than doctor reusing detectVersionDrift.
 */
export function templateFreshnessCheck(
  installedVersion: string | undefined,
  runningVersion: string,
): { status: 'pass' | 'warn'; detail: string } {
  if (installedVersion === undefined) {
    return {
      status: 'warn',
      detail: "no installed_version stamp — run 'metta install' to stamp",
    }
  }
  if (installedVersion === runningVersion) {
    return { status: 'pass', detail: runningVersion }
  }
  return {
    status: 'warn',
    detail: `installed ${installedVersion}, running ${runningVersion} — run 'metta install' to refresh`,
  }
}

// --- drift slot ---
// ADR-2: this module-scoped slot is a documented, deliberate exception to the
// no-singletons rule. One process = one CLI invocation: this is
// invocation-scoped state (written at most once in the preAction hook, read
// by outputJson), confined to this file behind an explicit record/get/reset
// API — not a service locator, not lazily-constructed shared infrastructure.
let recordedDrift: VersionDrift | null = null

export function recordVersionDrift(drift: VersionDrift): void {
  recordedDrift = drift
}

export function getVersionDrift(): VersionDrift | null {
  return recordedDrift
}

export function resetVersionDrift(): void {
  recordedDrift = null
}
