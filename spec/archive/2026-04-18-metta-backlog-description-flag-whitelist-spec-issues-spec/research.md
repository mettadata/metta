# Research: metta-backlog-description-flag-whitelist-spec-issues-spec

## Decision: minimal additive changes

### Key findings

1. **`BacklogStore.add(title, description, source, priority)`** already accepts description as a separate parameter (`src/backlog/backlog-store.ts:59`). The CLI just passes `title` for both. One-line wire-up.

2. **`metta-guard-edit.mjs:50-53`** ALLOW_LIST is currently exact-match. Need to extend to include `startsWith` matches for `spec/issues/` and `spec/backlog/`. Preserve existing exact-match entries.

3. **Skill template** at `src/templates/skills/metta-backlog/SKILL.md` currently tells the orchestrator to Edit the backlog file after add. Remove that instruction; instead pass `--description` via the CLI.

4. **Tests**:
   - `tests/cli.test.ts` already has backlog-related tests; add a `metta backlog add --description` case.
   - `tests/metta-guard-edit.test.ts` already exercises the allow-list; add new cases for `spec/issues/*.md` and `spec/backlog/*.md` (allowed) plus a control case for unrelated paths (still blocked).

### API sketch — CLI flag

```typescript
backlog
  .command('add')
  .argument('<title>', 'Item title')
  .option('--priority <level>', 'Priority: high, medium, low')
  .option('--source <source>', 'Source (e.g. idea/dark-mode)')
  .option('--description <text>', 'Full description body (defaults to title)')
  .action(async (title, options) => {
    // ...
    const description = options.description ?? title
    const slug = await ctx.backlogStore.add(title, description, options.source, options.priority)
    // ...
  })
```

### API sketch — hook allow-list

```javascript
const ALLOW_LIST = [
  'spec/project.md',
  '.metta/config.yaml',
]
const ALLOW_PREFIXES = [
  'spec/issues/',
  'spec/backlog/',
]
// ...
if (ALLOW_LIST.includes(relPath)) {
  process.exit(0)
}
if (ALLOW_PREFIXES.some((p) => relPath.startsWith(p) && relPath.endsWith('.md'))) {
  process.exit(0)
}
```

Allow prefix-matching only for `.md` files to avoid accidentally whitelisting unexpected paths under those dirs (e.g. `.DS_Store`).

### Mirror files

- `.claude/hooks/metta-guard-edit.mjs`
- `.claude/skills/metta-backlog/SKILL.md`

Both must stay byte-identical.

### Artifacts produced

None — direct code + skill edits.
