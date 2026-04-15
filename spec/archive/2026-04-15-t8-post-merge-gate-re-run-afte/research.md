# Research: t8-post-merge-gate-re-run-afte

Surgical bug fix; decisions locked in intent.

## Confirmed
- `src/ship/merge-safety.ts:200` (approximate) — `steps.push({ step: 'post-merge-gates', status: 'pass' })` is the unconditional stub to replace.
- Snapshot tag (`snapshotTag` variable in `run()`) is created earlier in the same method and is the rollback target.
- `src/cli/commands/ship.ts` constructs `new MergeSafetyPipeline(ctx.projectRoot)` — needs second arg.
- `src/gates/gate-registry.ts` exposes `runAll(names: string[], cwd: string): Promise<GateResult[]>` and `loadFromDirectory(dir: string)`.
- `createCliContext()` (`src/cli/helpers.ts`) instantiates `gateRegistry` but doesn't load gates by default. Ship CLI needs to call `loadFromDirectory` before constructing pipeline OR load lazily.
- Existing `merge-safety.test.ts` uses fixture branches without metta/ prefix; the new finalize-check skips them. Same skip-on-non-metta carries through — non-metta branches won't run post-merge gates either (no source branch convention to derive change name from).

## Mock pattern
```ts
const mockRegistry = {
  runAll: async (names: string[]) => names.map(name => ({ gate: name, status: 'pass', duration_ms: 1 })),
} as unknown as GateRegistry
```
Then construct: `new MergeSafetyPipeline(tempDir, mockRegistry)`.
