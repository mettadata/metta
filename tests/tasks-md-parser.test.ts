import { describe, it, expect } from 'vitest'
import { parseTasksMd } from '../src/planning/tasks-md-parser.js'

describe('parseTasksMd', () => {
  it('parses a single batch with two disjoint tasks and extracts Files correctly', () => {
    const md = [
      '# Tasks for demo',
      '',
      '## Batch 1 (no dependencies)',
      '',
      '- **Task 1.1: first task**',
      '  - **Files**: `src/a.ts`, `tests/a.test.ts`',
      '  - **Action**: Do the thing.',
      '  - **Verify**: Run the test.',
      '  - **Done**: Tests pass.',
      '',
      '- **Task 1.2: second task**',
      '  - **Files**: `src/b.ts`, `tests/b.test.ts`',
      '  - **Action**: Do the other thing.',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(1)
    const batch = graph.batches[0]
    expect(batch.batch).toBe(1)
    expect(batch.label).toBe('no dependencies')
    expect(batch.tasks).toHaveLength(2)

    expect(batch.tasks[0].id).toBe('1.1')
    expect(batch.tasks[0].files).toEqual(['src/a.ts', 'tests/a.test.ts'])
    expect(batch.tasks[0].dependsOn).toEqual([])

    expect(batch.tasks[1].id).toBe('1.2')
    expect(batch.tasks[1].files).toEqual(['src/b.ts', 'tests/b.test.ts'])
    expect(batch.tasks[1].dependsOn).toEqual([])
  })

  it('extracts dependsOn across batches including cross-batch references', () => {
    const md = [
      '# Tasks',
      '',
      '## Batch 1',
      '',
      '- **Task 1.1: root task**',
      '  - **Files**: `src/root.ts`',
      '',
      '## Batch 2 (depends on Batch 1)',
      '',
      '- **Task 2.1: downstream**',
      '  - **Depends on**: Task 1.1',
      '  - **Files**: `src/down.ts`',
      '',
      '- **Task 2.2: branches**',
      '  - **Depends on**: Task 1.1, Task 2.1',
      '  - **Files**: `src/branch.ts`',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(2)

    const b1 = graph.batches[0]
    expect(b1.batch).toBe(1)
    expect(b1.tasks).toHaveLength(1)
    expect(b1.tasks[0].id).toBe('1.1')
    expect(b1.tasks[0].dependsOn).toEqual([])

    const b2 = graph.batches[1]
    expect(b2.batch).toBe(2)
    expect(b2.label).toBe('depends on Batch 1')
    expect(b2.tasks).toHaveLength(2)
    expect(b2.tasks[0].id).toBe('2.1')
    expect(b2.tasks[0].dependsOn).toEqual(['1.1'])
    expect(b2.tasks[1].id).toBe('2.2')
    expect(b2.tasks[1].dependsOn).toEqual(['1.1', '2.1'])
  })

  it('treats a missing Files field as an empty array (soft-parse)', () => {
    const md = [
      '## Batch 1',
      '',
      '- **Task 1.1: no files declared**',
      '  - **Action**: stand alone action',
      '  - **Done**: done',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(1)
    expect(graph.batches[0].tasks).toHaveLength(1)
    expect(graph.batches[0].tasks[0].id).toBe('1.1')
    expect(graph.batches[0].tasks[0].files).toEqual([])
    expect(graph.batches[0].tasks[0].dependsOn).toEqual([])
  })

  it('skips malformed batch headers cleanly (no crash, no batch emitted)', () => {
    const md = [
      '## Batch without number',
      '',
      '- **Task 99.9: orphan task**',
      '  - **Files**: `src/orphan.ts`',
      '',
      '## Batch 1',
      '',
      '- **Task 1.1: valid task**',
      '  - **Files**: `src/valid.ts`',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(1)
    expect(graph.batches[0].batch).toBe(1)
    expect(graph.batches[0].tasks).toHaveLength(1)
    expect(graph.batches[0].tasks[0].id).toBe('1.1')
    expect(graph.batches[0].tasks[0].files).toEqual(['src/valid.ts'])
  })

  it('parses a subset of a real archived tasks.md fixture correctly', () => {
    // Subset extracted from:
    //   spec/archive/2026-04-19-adaptive-workflow-tier-selection-emit-complexity-score-after/tasks.md
    const md = [
      '# Tasks for adaptive-workflow-tier-selection-emit-complexity-score-after',
      '',
      '## Batch 1 (no dependencies)',
      '',
      '- [ ] **Task 1.1: Extend ChangeMetadataSchema with complexity and auto-accept fields**',
      '  - **Files**: `src/schemas/change-metadata.ts`, `tests/schemas.test.ts`',
      '  - **Action**: Add schema fields.',
      '  - **Verify**: `npx vitest run tests/schemas.test.ts`',
      '  - **Done**: All new schema tests pass.',
      '',
      '- [ ] **Task 1.2: Implement file-count-parser module**',
      '  - **Files**: `src/complexity/file-count-parser.ts`, `tests/complexity-file-count-parser.test.ts`',
      '  - **Action**: Create parser.',
      '  - **Verify**: `npx vitest run tests/complexity-file-count-parser.test.ts`',
      '',
      '## Batch 2 (depends on Batch 1)',
      '',
      '- [ ] **Task 2.1: Extend ArtifactStore.createChange with autoAccept parameter**',
      '  - **Depends on**: Task 1.1',
      '  - **Files**: `src/artifacts/artifact-store.ts`, `tests/artifact-store.test.ts`',
      '  - **Action**: Extend the method.',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(2)

    const b1 = graph.batches[0]
    expect(b1.batch).toBe(1)
    expect(b1.tasks).toHaveLength(2)
    expect(b1.tasks[0].id).toBe('1.1')
    expect(b1.tasks[0].files).toEqual([
      'src/schemas/change-metadata.ts',
      'tests/schemas.test.ts',
    ])
    expect(b1.tasks[0].dependsOn).toEqual([])
    expect(b1.tasks[1].id).toBe('1.2')
    expect(b1.tasks[1].files).toEqual([
      'src/complexity/file-count-parser.ts',
      'tests/complexity-file-count-parser.test.ts',
    ])
    expect(b1.tasks[1].dependsOn).toEqual([])

    const b2 = graph.batches[1]
    expect(b2.batch).toBe(2)
    expect(b2.tasks).toHaveLength(1)
    expect(b2.tasks[0].id).toBe('2.1')
    expect(b2.tasks[0].dependsOn).toEqual(['1.1'])
    expect(b2.tasks[0].files).toEqual([
      'src/artifacts/artifact-store.ts',
      'tests/artifact-store.test.ts',
    ])
  })

  it('returns an empty batches array for an empty document', () => {
    expect(parseTasksMd('')).toEqual({ batches: [] })
    expect(parseTasksMd('   \n\n  ')).toEqual({ batches: [] })
  })

  it('parses Files declared as a nested bullet list (one file per line)', () => {
    const md = [
      '## Batch 1',
      '',
      '- **Task 1.1: nested files**',
      '  - **Files**:',
      '    - `src/a.ts`',
      '    - `src/b.ts`',
      '    - `tests/c.test.ts`',
      '  - **Action**: do it.',
      '',
    ].join('\n')

    const graph = parseTasksMd(md)
    expect(graph.batches).toHaveLength(1)
    expect(graph.batches[0].tasks).toHaveLength(1)
    expect(graph.batches[0].tasks[0].files).toEqual([
      'src/a.ts',
      'src/b.ts',
      'tests/c.test.ts',
    ])
  })
})
