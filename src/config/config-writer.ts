import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML, { YAMLSeq, Scalar, isSeq } from 'yaml'

/**
 * Set a nested field in `<root>/.metta/config.yaml`, preserving comments
 * and flow-style sequences where possible.
 *
 * Does NOT auto-create the config file — ENOENT is propagated to the caller.
 */
export async function setProjectField(root: string, path: string[], value: unknown): Promise<void> {
  const configPath = join(root, '.metta', 'config.yaml')
  const raw = await readFile(configPath, 'utf8')

  const doc = YAML.parseDocument(raw)
  if (doc.errors.length > 0) {
    throw new Error(`Failed to parse ${configPath}: ${doc.errors[0].message}`)
  }

  if (Array.isArray(value)) {
    const existing = doc.getIn(path, true)
    if (isSeq(existing) && (existing as YAMLSeq).flow === true) {
      const newSeq = new YAMLSeq()
      newSeq.flow = true
      for (const item of value) {
        newSeq.add(new Scalar(item))
      }
      doc.setIn(path, newSeq)
    } else {
      doc.setIn(path, value)
    }
  } else {
    doc.setIn(path, value)
  }

  await writeFile(configPath, doc.toString(), 'utf8')
}
