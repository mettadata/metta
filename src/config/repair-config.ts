import YAML, { isMap } from 'yaml'
import { ProjectConfigSchema } from '../schemas/project-config.js'

export interface RepairResult {
  source: string
  duplicatesRemoved: string[]
  invalidKeysRemoved: string[]
  changed: boolean
}

/**
 * Pure function that repairs a YAML project config source by:
 *   - Removing duplicate keys at the top level and one level deep (keeps last occurrence)
 *   - Dropping schema-invalid keys (unrecognized top-level keys and keys with
 *     type/enum violations) based on ProjectConfigSchema
 *
 * Never throws on malformed YAML — returns the original source unchanged.
 */
export function repairProjectConfig(source: string): RepairResult {
  const duplicatesRemoved: string[] = []
  const invalidKeysRemoved: string[] = []

  let doc: YAML.Document.Parsed
  try {
    doc = YAML.parseDocument(source, { uniqueKeys: false })
  } catch {
    return { source, duplicatesRemoved, invalidKeysRemoved, changed: false }
  }

  if (doc.contents === null || doc.contents === undefined) {
    return { source, duplicatesRemoved, invalidKeysRemoved, changed: false }
  }

  // If the AST is irrecoverable (parse errors), treat as fatal and passthrough.
  if (doc.errors.length > 0) {
    return { source, duplicatesRemoved, invalidKeysRemoved, changed: false }
  }

  // Step 2 — dedup walk: top-level map and each child map one level deep.
  const topMap = doc.contents
  if (isMap(topMap)) {
    dedupMap(topMap, duplicatesRemoved)
    for (const item of topMap.items) {
      if (isMap(item.value)) {
        dedupMap(item.value, duplicatesRemoved)
      }
    }
  }

  // Step 3 — schema-invalid key removal, up to 3 passes.
  for (let pass = 0; pass < 3; pass++) {
    let json: unknown
    try {
      json = doc.toJSON()
    } catch {
      break
    }

    const result = ProjectConfigSchema.safeParse(json)
    if (result.success) {
      break
    }

    let deletionsThisPass = 0
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const keys = (issue as unknown as { keys?: string[] }).keys ?? []
        for (const badKey of keys) {
          const deletePath = [...issue.path, badKey]
          if (doc.deleteIn(deletePath)) {
            deletionsThisPass++
            invalidKeysRemoved.push(`dropped unrecognized key '${badKey}'`)
          }
        }
      } else {
        if (issue.path.length === 0) {
          continue
        }
        if (doc.deleteIn(issue.path)) {
          deletionsThisPass++
          invalidKeysRemoved.push(`dropped invalid key '${issue.path.join('.')}'`)
        }
      }
    }

    if (deletionsThisPass === 0) {
      break
    }
  }

  // Step 4 — finalize. If we made no repair-worthy changes, return the
  // original source bytewise to avoid spurious reformatting diffs.
  if (duplicatesRemoved.length === 0 && invalidKeysRemoved.length === 0) {
    return { source, duplicatesRemoved, invalidKeysRemoved, changed: false }
  }

  let repaired: string
  try {
    repaired = doc.toString()
  } catch {
    return { source, duplicatesRemoved, invalidKeysRemoved, changed: false }
  }
  const changed = repaired !== source
  return { source: repaired, duplicatesRemoved, invalidKeysRemoved, changed }
}

/**
 * Mutates the given YAMLMap by removing duplicate-keyed items (keeping the
 * last occurrence) and pushing human-readable labels into `log`.
 */
function dedupMap(map: YAML.YAMLMap, log: string[]): void {
  const seen = new Set<string>()
  for (let i = map.items.length - 1; i >= 0; i--) {
    const item = map.items[i]
    const keyNode = item.key as unknown
    let keyStr: string | null = null
    if (keyNode !== null && keyNode !== undefined) {
      if (typeof keyNode === 'object' && keyNode !== null && 'value' in keyNode) {
        const v = (keyNode as { value: unknown }).value
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          keyStr = String(v)
        }
      } else if (typeof keyNode === 'string' || typeof keyNode === 'number' || typeof keyNode === 'boolean') {
        keyStr = String(keyNode)
      }
    }
    if (keyStr === null) {
      continue
    }
    if (seen.has(keyStr)) {
      map.items.splice(i, 1)
      log.push(`removed duplicate key '${keyStr}' (kept last occurrence)`)
    } else {
      seen.add(keyStr)
    }
  }
}
