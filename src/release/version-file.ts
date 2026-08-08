import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ReleaseConfig } from '../schemas/project-config.js'

/**
 * Product-version file I/O (edge).
 *
 * Reads and writes the host project's product version from the file named by
 * `release.version_file`. The product version is a concept entirely separate
 * from metta's own install stamp — this module never touches metta state
 * (spec: Product Version Distinct From Installed Version).
 *
 * Strategies:
 * - Paths ending in `.json`: the top-level `version` field is read/written.
 *   Writes replace only the value's bytes in the raw text, so indentation,
 *   key order, and trailing-newline presence are preserved exactly.
 * - Any other path: the whole file is the version — read trimmed, written
 *   back preserving the file's trailing-newline convention.
 */

/** Failure reading or writing the product version file. */
export class ProductVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductVersionError'
  }
}

interface Span {
  start: number
  end: number
}

/**
 * Locate the string value of the top-level `version` key in raw JSON text.
 *
 * Character scanner tracking brace depth and string state: a string token at
 * depth 1 followed by `:` is necessarily a key of the top-level object, so a
 * nested `version` key (e.g. inside `dependencies`) can never be matched.
 * Returns the span of the value string literal including its quotes, or
 * `null` when no top-level string-valued `version` key exists.
 */
function locateTopLevelVersionValue(raw: string): Span | null {
  let depth = 0
  let i = 0

  const readString = (from: number): Span | null => {
    // from points at the opening quote
    let j = from + 1
    while (j < raw.length) {
      const ch = raw[j]
      if (ch === '\\') {
        j += 2
        continue
      }
      if (ch === '"') return { start: from, end: j + 1 }
      j += 1
    }
    return null
  }

  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '"') {
      const key = readString(i)
      if (key === null) return null
      if (depth === 1 && raw.slice(key.start + 1, key.end - 1) === 'version') {
        let j = key.end
        while (j < raw.length && /\s/.test(raw[j]!)) j += 1
        if (raw[j] === ':') {
          j += 1
          while (j < raw.length && /\s/.test(raw[j]!)) j += 1
          if (raw[j] === '"') return readString(j)
          return null // key exists but value is not a string
        }
      }
      i = key.end
      continue
    }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
    i += 1
  }
  return null
}

async function readRaw(projectRoot: string, config: ReleaseConfig): Promise<string> {
  const path = resolve(projectRoot, config.version_file)
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const detail = code === 'ENOENT' ? 'file not found' : `not readable (${code ?? 'unknown error'})`
    throw new ProductVersionError(
      `Cannot read product version from '${config.version_file}': ${detail}`,
    )
  }
}

function isJsonStrategy(config: ReleaseConfig): boolean {
  return config.version_file.endsWith('.json')
}

/** Read the current product version from the configured version file. */
export async function readProductVersion(
  projectRoot: string,
  config: ReleaseConfig,
): Promise<string> {
  const raw = await readRaw(projectRoot, config)

  if (!isJsonStrategy(config)) {
    const version = raw.trim()
    if (version === '') {
      throw new ProductVersionError(
        `Cannot read product version from '${config.version_file}': file is empty`,
      )
    }
    return version
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ProductVersionError(
      `Cannot read product version from '${config.version_file}': file is not valid JSON`,
    )
  }
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['version']
      : undefined
  if (typeof version !== 'string') {
    throw new ProductVersionError(
      `Cannot read product version from '${config.version_file}': top-level 'version' field is missing or not a string`,
    )
  }
  return version
}

/**
 * Write `next` as the product version into the configured version file,
 * preserving the file's existing formatting.
 */
export async function writeProductVersion(
  projectRoot: string,
  config: ReleaseConfig,
  next: string,
): Promise<void> {
  const raw = await readRaw(projectRoot, config)
  const path = resolve(projectRoot, config.version_file)

  if (!isJsonStrategy(config)) {
    const trailingNewline = raw === '' || raw.endsWith('\n')
    await writeFile(path, trailingNewline ? `${next}\n` : next, 'utf8')
    return
  }

  // Validate structure with the same rules as reading before touching bytes.
  await readProductVersion(projectRoot, config)

  const span = locateTopLevelVersionValue(raw)
  if (span === null) {
    throw new ProductVersionError(
      `Cannot write product version to '${config.version_file}': top-level 'version' field is missing or not a string`,
    )
  }
  const updated = raw.slice(0, span.start) + JSON.stringify(next) + raw.slice(span.end)
  await writeFile(path, updated, 'utf8')
}
