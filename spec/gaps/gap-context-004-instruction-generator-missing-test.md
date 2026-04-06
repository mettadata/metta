# GAP-CONTEXT-004: InstructionGenerator Has No Test for Tool Object Normalization

## Status: Open

## Location

`src/context/instruction-generator.ts` — `generate()`, lines 76–79
`tests/instruction-generator.test.ts`

## Description

`InstructionGenerator.generate` normalizes agent tools: string entries pass through; object entries have their first key extracted. The test suite exercises only the string-tool case (`tools: ['Read', 'Grep', 'Glob']`). No test verifies the object-entry path, which is the form used by `Bash` tool configurations in `AgentDefinitionSchema`:

```typescript
// ToolEntry = string | Record<string, BashToolConfig>
tools: [{ Bash: { deny_patterns: ['rm -rf'], allow_cwd: 'worktree_only' } }]
```

## Impact

Low (the normalization is a single line), but the uncovered branch could silently produce unexpected tool names if `Object.keys` ordering or tool object shape changes.

## Recommended Fix

Add a test case to `tests/instruction-generator.test.ts` where `agent.tools` contains at least one object entry and assert that the output `agent.tools` array contains the extracted key string (e.g., `'Bash'`).

## Related

`src/schemas/agent-definition.ts` — `ToolEntrySchema` defines the union type that creates this dual-path normalization requirement.
