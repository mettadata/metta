# Research: `metta doctor --fix` Repair Strategy

Change: `harden-metta-config-yaml-lifecycle-across-three-related-bugs`
Date: 2026-04-20

---

## Grounding

- `yaml` package pinned at `^2.7.1` in `package.json`; `yaml.parseDocument` with
  `{ uniqueKeys: false }` is available and confirmed working.[^1]
- Default `YAML.parse()` (used by `config-loader.ts`) throws `"Map keys must be
  unique"` when duplicates are present — this is exactly the failure mode doctor
  must survive.
- Zod `unrecognized_keys` issues carry a `keys: string[]` array alongside `path`,
  letting us identify all offending keys in one pass without iterating per-issue.[^2]

[^1]: verified locally against node_modules/yaml v2.7.x, 2026-04-20
[^2]: verified locally against node_modules/zod, 2026-04-20

---

## Q1 — Parse-mode for lenient reading

**Three options:**

| | Approach | Notes |
|---|---|---|
| A | `yaml.parseDocument(source, { uniqueKeys: false })` directly in doctor | No new modules; doctor already imports other helpers |
| B | `ConfigLoader.load({ lenient: true })` method | Adds config-loader surface; config-loader is not the right owner for repair semantics |
| C | New `src/config/config-reader.ts` | Adds a file and indirection for one call-site |

**Recommendation: Option A.**

Doctor is the only consumer that needs lenient YAML reading. Pulling this logic
into `ConfigLoader` would pollute a well-scoped loading class with repair
concerns; a new helper module adds indirection without value. A direct call to
`yaml.parseDocument(source, { uniqueKeys: false })` inside the `--fix` action
handler is two lines, fully transparent, and matches how `state-store.ts` and
`config-loader.ts` already import `yaml` directly.

---

## Q2 — Dedup semantics: last occurrence wins

**Recommendation: keep last occurrence.**

YAML `parseDocument` with `{ uniqueKeys: false }` resolves conflicts in document
order: earlier keys are shadowed by later keys. `doc.toJSON()` returns the last
value for each key. This matches how `metta install` has been appending new
`stacks:` blocks — the newest install run's intent is at the bottom of the file.
Keeping the last occurrence means the most recent write survives, which is the
correct semantic for an install-time append pattern.

Implementation is zero-effort: `parseDocument(..., { uniqueKeys: false })` already
does last-wins internally. Dedup "repair" is simply re-serialising the Document
after calling `yaml.stringify(doc)` — all first occurrences of duplicate keys are
dropped automatically.

---

## Q3 — Schema-invalid key removal

After dedup, `ProjectConfigSchema.safeParse(doc.toJSON())` may flag unrecognized
top-level or nested keys.

**Three options:**

| | Approach | Notes |
|---|---|---|
| A | Iterate Zod issue paths, call `doc.deleteIn(path)` per bad key | Surgical; preserves YAML formatting and comments |
| B | Reconstruct config from `safeParse` success path, re-serialize as plain JSON | Loses YAML style entirely; poor user experience |
| C | Delegate to `setProjectField` per valid key | `setProjectField` is not a real existing helper; would need building |

**Recommendation: Option A — `doc.deleteIn` per Zod issue.**

`doc.deleteIn(['badKey'])` works correctly for top-level keys (confirmed
locally). The Zod `unrecognized_keys` issue shape is:

```
{ code: 'unrecognized_keys', keys: string[], path: (string|number)[] }
```

`path` is the path to the *object* containing the unrecognized keys; `keys` is
the list of bad key names. So the deletion path for each bad key is
`[...issue.path, badKey]`. One loop covers both top-level and nested cases.

For non-`unrecognized_keys` failures (type errors, enum violations) the correct
repair is to drop the entire offending field. The `issue.path` points directly
at the bad value; `doc.deleteIn(issue.path)` removes it.

Each deletion should be reported to the user (`  - dropped .metta/config.yaml
key 'badKey': unrecognized`), satisfying the per-removal reporting requirement.

---

## Q4 — Commit idempotency

Read the file before and after repair. Compare by content string. Only write and
commit if `repairedSource !== originalSource`.

```
const original = await readFile(configPath, 'utf-8')
const repaired = runRepair(original)          // pure, no I/O
if (repaired === original) {
  console.log('  No changes needed.')
  return
}
await writeFile(configPath, repaired)
await autoCommitFile(projectRoot, configPath, 'chore: metta doctor repaired .metta/config.yaml')
```

This handles the second-run no-op case without any state file or hash storage.

---

## Q5 — Branch safety

`issue.ts` calls `assertOnMainBranch` because issues are canonical project
records that must live on the main branch. `doctor --fix` is repairing a local
tool-config file (`.metta/config.yaml`), not a spec artifact.

**Recommendation: do NOT apply `assertOnMainBranch` to `doctor --fix`.**

A developer may need to repair config on a feature branch before they can run
any `metta` command at all (the hard-fail parse is blocking them). Refusing
repair because they are on the wrong branch would be actively harmful. The
repair commit only touches `.metta/config.yaml`, which is not a versioned spec
artifact. `autoCommitFile` already refuses to commit when other tracked files
are dirty, which provides adequate guard against accidental side effects.

---

## Q6 — Reporting format

**Human mode (default):** print one line per removed key before the commit line.
No dry-run flag is needed — the operation is idempotent and reversible via git.

```
  Repaired .metta/config.yaml:
    - removed duplicate key 'project' (kept last occurrence)
    - dropped unrecognized key 'badkey'
  Committed: a3f91c2
```

**`--json` mode:** extend the existing `checks` array with a repair result entry,
or return a top-level `repair` object alongside `checks`:

```json
{
  "repair": {
    "changed": true,
    "removed_keys": ["project (duplicate)", "badkey (unrecognized)"],
    "committed": true,
    "commit_sha": "a3f91c2"
  }
}
```

No separate `--dry-run` flag. The action is idempotent: running it on an already-
clean file is a safe no-op.

---

## Concrete Recommendation

### Function signature

```typescript
// src/config/repair-config.ts

export interface RepairResult {
  changed: boolean
  removedKeys: string[]      // human-readable label per removal
  repairedSource: string     // final YAML string (equals input when changed=false)
}

export function repairProjectConfig(source: string): RepairResult
```

`repairProjectConfig` is a **pure function** (no I/O). It takes the raw YAML
string and returns the repaired YAML string plus a log of what changed. The
`--fix` action handler owns all I/O (read, write, commit).

### Pseudo-code for the `--fix` action handler

```
// Inside registerDoctorCommand, after existing checks:

if (options.fix) {
  const configPath = join(ctx.projectRoot, '.metta', 'config.yaml')

  let source: string
  try {
    source = await readFile(configPath, 'utf-8')
  } catch {
    console.log('  No .metta/config.yaml found — nothing to repair.')
    return
  }

  const { changed, removedKeys, repairedSource } = repairProjectConfig(source)

  if (!changed) {
    console.log('  .metta/config.yaml is already valid — no changes needed.')
    return
  }

  if (!json) {
    console.log('  Repaired .metta/config.yaml:')
    for (const label of removedKeys) console.log(`    - ${label}`)
  }

  await writeFile(configPath, repairedSource, 'utf-8')
  const commit = await autoCommitFile(
    ctx.projectRoot,
    configPath,
    'chore: metta doctor repaired .metta/config.yaml',
  )

  if (json) {
    outputJson({ repair: { changed, removedKeys, committed: commit.committed, commit_sha: commit.sha ?? null } })
  } else {
    if (commit.committed) console.log(`  Committed: ${commit.sha?.slice(0, 7)}`)
    else if (commit.reason) console.log(`  Not committed: ${commit.reason}`)
  }
}
```

### Pseudo-code for `repairProjectConfig`

```
function repairProjectConfig(source: string): RepairResult {
  const removed: string[] = []

  // Step 1: parse leniently
  const doc = yaml.parseDocument(source, { uniqueKeys: false })

  // Step 2: dedup — collect all top-level keys, find those appearing > once
  const items = doc.contents.items   // Pair[]
  const seen = new Map<string, number>()   // key -> last index
  for (let i = 0; i < items.length; i++) {
    const key = items[i].key.value as string
    if (seen.has(key)) removed.push(`removed duplicate key '${key}' (kept last occurrence)`)
    seen.set(key, i)
  }
  // Keep only the last occurrence of each key
  const deduped = items.filter((item, i) => seen.get(item.key.value) === i)
  doc.contents.items = deduped

  // Step 3: validate against schema
  const parsed = ProjectConfigSchema.safeParse(doc.toJSON())
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const badKey of issue.keys) {
          const deletePath = [...issue.path, badKey]
          doc.deleteIn(deletePath)
          removed.push(`dropped unrecognized key '${deletePath.join('.')}'`)
        }
      } else {
        // type/enum/other violation — drop the whole field
        if (issue.path.length > 0) {
          doc.deleteIn(issue.path)
          removed.push(`dropped invalid key '${issue.path.join('.')}': ${issue.message}`)
        }
      }
    }
  }

  const repairedSource = yaml.stringify(doc)
  const changed = repairedSource !== source || removed.length > 0
  return { changed, removedKeys: removed, repairedSource }
}
```

Note: after `unrecognized_keys` deletions, a second `safeParse` pass is advisable
to catch cascading issues (e.g., a nested object becomes invalid after its only
valid sibling is removed). A simple loop running up to 3 passes covers all
realistic cases without infinite-loop risk.

---

## Summary of decisions

| Question | Decision |
|---|---|
| Lenient parse | `yaml.parseDocument(source, { uniqueKeys: false })` directly in doctor |
| Dedup winner | Last occurrence — matches install-time append semantics |
| Schema removal | `doc.deleteIn([...issue.path, badKey])` per Zod unrecognized key |
| Idempotency | Compare `repairedSource !== originalSource`; skip write+commit when equal |
| Branch guard | No `assertOnMainBranch` — repair must work on any branch |
| Reporting | Per-key lines in human mode; `repair` object in `--json` mode; no dry-run flag |
