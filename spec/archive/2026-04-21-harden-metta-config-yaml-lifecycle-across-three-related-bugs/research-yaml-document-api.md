# Research: yaml Document API for `setProjectField`

**Date:** 2026-04-20
**Scope:** Replacing regex-based config mutation in `src/cli/commands/install.ts` with a
`setProjectField(root, path, value)` helper that uses the `yaml` library's Document API.

---

## Environment Baseline

- `yaml` installed version: **2.8.3** (declared `^2.7.1` in `package.json`) [^1]
- Runtime: Node.js >=22, ESM only
- Existing usage: `YAML.parse(content)` in `src/config/config-loader.ts:53` — plain parse, no Document API yet
- Target file to replace: `src/cli/commands/install.ts:177-208` — regex/splice approach

[^1]: `/home/utx0/Code/metta/node_modules/yaml/package.json`, accessed 2026-04-20

---

## Current Problem (lines 177-208 of `install.ts`)

The existing `writeStacksToConfig` function:
1. Reads the file as a raw string and splits on `\n`
2. Searches for a line matching `/^\s*stack:\s*"/` and splices in a replacement
3. If no `stack:` line exists, searches for `project:` and walks down to find the insertion point
4. Falls back to appending a new `project:` block

**Known failure modes:**
- Not idempotent: calling twice appends a second `stacks:` line if the regex doesn't match the first one
- Misses the case where `stacks:` already exists as a block-style array (written by a previous run using the Document API)
- No protection against leaving duplicate keys in the file
- Comment lines adjacent to `project:` or `stacks:` may be displaced by splice logic

---

## Strategy 1 — `yaml.parseDocument` + `doc.setIn` + `doc.toString()` (RECOMMENDED)

### How it works

```typescript
import YAML from 'yaml'
import { readFile, writeFile } from 'node:fs/promises'

async function setProjectField(root: string, path: string[], value: unknown): Promise<void> {
  const configPath = `${root}/.metta/config.yaml`
  const raw = await readFile(configPath, 'utf8')          // throws ENOENT if absent
  const doc = YAML.parseDocument(raw)
  doc.setIn(path, value)
  await writeFile(configPath, doc.toString(), 'utf8')
}
```

### Comment preservation

`parseDocument` attaches YAML comments to the AST node that follows them (as `commentBefore`)
and to the node they trail (as `comment`). `doc.toString()` re-emits them in the same
positions. A `# project-specific override` comment above `stacks:` survives a `setIn` call on
`['project', 'stacks']` because `setIn` replaces only the value node for `stacks`, leaving the
key node (which carries `commentBefore`) intact. [^2]

[^2]: https://eemeli.org/yaml/#documents accessed 2026-04-20

### Idempotency

`setIn` on an existing key **replaces** the value node in-place; it never appends a second
mapping pair for the same key. For scalar→scalar replacement the original node wrapper is
reused, so tags and anchors on the key side are preserved. Calling `setIn` twice with the same
value produces identical AST → identical `toString()` output. The only caveat is trailing
newline normalization: `doc.toString()` always ends with exactly one `\n`, so an input that
lacks a trailing newline will gain one after the first write; subsequent writes are stable.

### Type coercion and flow/block style

When `value` is a plain JS array (e.g., `['rust', 'typescript']`), `setIn` converts it to a
YAML Sequence node using the document's default style — **block** unless the surrounding
collection is already flow. If the existing `stacks:` value is a flow sequence
(`stacks: ["rust"]`) and we call `setIn(['project', 'stacks'], ['rust', 'ts'])`, the existing
flow sequence node is **replaced** (not mutated in-place) with a new Sequence created from the
plain JS array, which defaults to **block** style. [^3]

To preserve flow style for arrays, pass a `yaml.YAMLSeq` node instead of a plain JS array:

```typescript
import { YAMLSeq, Scalar } from 'yaml'

function toFlowSeq(values: string[]): YAMLSeq {
  const seq = new YAMLSeq()
  seq.flow = true
  for (const v of values) seq.add(new Scalar(v))
  return seq
}
doc.setIn(['project', 'stacks'], toFlowSeq(stacks))
```

For the `install.ts` use-case, the spec's scenario uses `["typescript"]` (flow). To match the
existing template output, the helper should detect the current node's flow property and mirror
it. If matching style is not a spec requirement, block style is the safer default (no
information loss, more diff-friendly).

[^3]: https://eemeli.org/yaml/#modifying-nodes accessed 2026-04-20

### Duplicate-key tolerance

When the input YAML already has two `stacks:` keys (a corrupt file), the default
`uniqueKeys: true` parse causes `doc.errors` to be populated but **does not throw** —
`parseDocument` never throws; it collects errors. The first occurrence wins in the AST.
`setIn` will update only that first occurrence, leaving the second key as an orphan in the
serialized output (it re-appears via `toString()`). This is a problem; see the doctor dedup
section below.

### Error modes

- File not found: `readFile` throws `ENOENT` — surfaces to caller, correct behavior per spec
- Malformed YAML: `parseDocument` does not throw; errors populate `doc.errors`. Callers should
  check `if (doc.errors.length) throw doc.errors[0]` before calling `setIn`
- Null document (empty file): `doc.contents` is `null`; `setIn` on a null document
  auto-creates the path. For metta's purposes this is acceptable since config is always
  bootstrapped by `install`

### Test ergonomics

Straightforward to unit-test with in-memory strings:

```typescript
const raw = `# header comment\nproject:\n  # stacks comment\n  stacks: ["rust"]\n`
const doc = YAML.parseDocument(raw)
doc.setIn(['project', 'stacks'], ['rust', 'typescript'])
const out = doc.toString()
assert(out.includes('# stacks comment'))
assert(!out.includes('stacks:') === false)   // key still present once
```

No filesystem mocking required for the core logic; only the file I/O wrapper needs a tmp
directory or mock.

---

## Strategy 2 — `yaml.parse` + mutate JS object + `yaml.stringify` (ANTI-OPTION)

`YAML.parse(raw)` returns a plain JS object. Mutating it and calling `YAML.stringify()` is
already used in `config-loader.ts` for reading but is **not appropriate for writing**:

- **All comments are dropped** — `parse` discards the AST; `stringify` emits a fresh document
- Flow vs block style of arrays is not preserved
- Any anchor/alias in the source is lost

This is the existing anti-pattern in `config-loader.ts` (reads only, never writes back).
Do not use for `setProjectField`.

---

## Strategy 3 — Manual CST Surgery via `yaml`'s CST API (OVERKILL)

The CST API (`yaml/dist/parse/cst.js`, exported as `YAML.cst`) preserves every source
character including whitespace and comment tokens. `CST.visit()` can walk token by token and
splice in replacement scalars.

- Pro: byte-perfect round-trip for unchanged regions
- Con: requires operating on raw token streams; string replacement of value tokens is
  non-trivial and error-prone for anything beyond a simple scalar change
- Con: no official high-level `setIn` equivalent; must be hand-rolled
- Con: API is documented as low-level and subject to change [^2]

For setting a single string-array field this is disproportionate. Strategy 1 already achieves
comment preservation with a three-line core; CST surgery is only warranted if exact byte
preservation of all whitespace (including insignificant trailing spaces) is a hard requirement.
Verdict: do not use.

---

## `metta doctor --fix` Dedup Logic

### Problem

A corrupt config file may contain duplicate `stacks:` keys written by repeated regex-based
`install` runs. The doctor fix must detect and collapse them to the last occurrence (most
recent write wins) without losing other fields.

### Option A — `uniqueKeys: false` + AST walk (RECOMMENDED)

```typescript
const doc = YAML.parseDocument(raw, { uniqueKeys: false })
// doc.errors is empty; all keys survive in the AST as YAMLMap items
const projectMap = doc.getIn(['project'], /* keepNodeType */ true) as YAML.YAMLMap | undefined
if (projectMap instanceof YAML.YAMLMap) {
  const seen = new Map<string, number>()
  // Walk items in reverse to keep the LAST occurrence
  for (let i = projectMap.items.length - 1; i >= 0; i--) {
    const keyStr = String((projectMap.items[i] as YAML.Pair).key)
    if (seen.has(keyStr)) {
      projectMap.items.splice(i, 1)   // remove earlier duplicate
    } else {
      seen.set(keyStr, i)
    }
  }
}
await writeFile(configPath, doc.toString(), 'utf8')
```

`uniqueKeys: false` is the correct parse option: it allows the document to parse without
errors while keeping all key occurrences in `YAMLMap.items`. The walk above retains the last
occurrence (most recent install run) and removes earlier ones. Comments attached to removed
keys are dropped — acceptable for a fix operation.

### Option B — parse + detect via `doc.errors` + rebuild

With default `uniqueKeys: true`, `parseDocument` puts duplicate-key errors into `doc.errors`.
We can detect them, then re-parse with `uniqueKeys: false` to dedup. This two-pass approach
works but is redundant — just use `uniqueKeys: false` from the start (Option A).

---

## Recommendation

**Use Strategy 1 (`parseDocument` + `setIn` + `toString`)** for `setProjectField`.

It is the canonical yaml v2 Document API pattern, already consistent with the `yaml` import
style in `config-loader.ts`, preserves comments, is idempotent for repeated calls with the
same value, and has straightforward test ergonomics.

---

## Minimal Diff Sketch: `src/config/config-writer.ts`

```typescript
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML, { YAMLSeq, Scalar } from 'yaml'

/**
 * Mutate a single field in `.metta/config.yaml` using the yaml Document API.
 * Preserves all comments and blank lines outside the mutated node.
 * Throws ENOENT if the config file does not exist.
 * Throws the first parse error if the document is malformed.
 */
export async function setProjectField(
  root: string,
  path: string[],
  value: unknown,
): Promise<void> {
  const configPath = join(root, '.metta', 'config.yaml')
  const raw = await readFile(configPath, 'utf8')   // intentionally throws on ENOENT
  const doc = YAML.parseDocument(raw)
  if (doc.errors.length > 0) throw doc.errors[0]

  // Mirror flow style of existing array node when replacing with an array value
  if (Array.isArray(value)) {
    const existing = doc.getIn(path, true)
    const useFlow = existing instanceof YAMLSeq ? existing.flow ?? false : false
    const seq = new YAMLSeq()
    seq.flow = useFlow
    for (const item of value as unknown[]) seq.add(new Scalar(item))
    doc.setIn(path, seq)
  } else {
    doc.setIn(path, value)
  }

  await writeFile(configPath, doc.toString(), 'utf8')
}
```

**Callers in `install.ts`** replace `writeStacksToConfig(root, stacks)` with:

```typescript
await setProjectField(root, ['project', 'stacks'], stacks)
```

The full regex/splice block (`lines 187-208`) is deleted.

---

## Doctor `--fix` Dedup Sketch

```typescript
export async function dedupConfigKeys(root: string): Promise<boolean> {
  const configPath = join(root, '.metta', 'config.yaml')
  const raw = await readFile(configPath, 'utf8')
  const doc = YAML.parseDocument(raw, { uniqueKeys: false })
  let changed = false

  function dedupMap(map: YAML.YAMLMap): void {
    const seen = new Set<string>()
    for (let i = map.items.length - 1; i >= 0; i--) {
      const key = String((map.items[i] as YAML.Pair).key)
      if (seen.has(key)) {
        map.items.splice(i, 1)
        changed = true
      } else {
        seen.add(key)
      }
    }
  }

  if (doc.contents instanceof YAML.YAMLMap) {
    dedupMap(doc.contents)
    for (const pair of doc.contents.items as YAML.Pair[]) {
      if (pair.value instanceof YAML.YAMLMap) dedupMap(pair.value)
    }
  }

  if (changed) await writeFile(configPath, doc.toString(), 'utf8')
  return changed
}
```

Returns `true` if duplicates were found and removed so the caller can report `fixed` vs `ok`.
