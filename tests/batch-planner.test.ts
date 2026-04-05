import { describe, it, expect } from 'vitest'
import { planBatches, parseTasks, type TaskDefinition } from '../src/execution/batch-planner.js'

describe('planBatches', () => {
  it('groups independent tasks into one batch', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Create auth models', files: ['src/auth/model.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '1.2', name: 'Create product models', files: ['src/product/model.ts'], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].tasks).toHaveLength(2)
    expect(plan.batches[0].parallel).toBe(true)
  })

  it('creates sequential batches for dependent tasks', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Models', files: ['src/model.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '2.1', name: 'API', files: ['src/api.ts'], depends_on: ['1.1'], action: '', verify: '', done: '' },
      { id: '3.1', name: 'Tests', files: ['tests/api.test.ts'], depends_on: ['2.1'], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    expect(plan.batches).toHaveLength(3)
    expect(plan.batches[0].tasks[0].id).toBe('1.1')
    expect(plan.batches[1].tasks[0].id).toBe('2.1')
    expect(plan.batches[2].tasks[0].id).toBe('3.1')
  })

  it('detects file overlap and marks batch as non-parallel', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Task A', files: ['src/shared.ts', 'src/a.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '1.2', name: 'Task B', files: ['src/shared.ts', 'src/b.ts'], depends_on: [], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].parallel).toBe(false)
  })

  it('throws on circular dependencies', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'A', files: [], depends_on: ['2.1'], action: '', verify: '', done: '' },
      { id: '2.1', name: 'B', files: [], depends_on: ['1.1'], action: '', verify: '', done: '' },
    ]
    expect(() => planBatches(tasks)).toThrow('Circular dependency')
  })

  it('handles complex dependency graph', () => {
    const tasks: TaskDefinition[] = [
      { id: '1.1', name: 'Auth models', files: ['src/auth/model.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '1.2', name: 'Product models', files: ['src/product/model.ts'], depends_on: [], action: '', verify: '', done: '' },
      { id: '2.1', name: 'Auth API', files: ['src/auth/api.ts'], depends_on: ['1.1'], action: '', verify: '', done: '' },
      { id: '2.2', name: 'Product API', files: ['src/product/api.ts'], depends_on: ['1.2'], action: '', verify: '', done: '' },
      { id: '3.1', name: 'Checkout', files: ['src/checkout.ts'], depends_on: ['2.1', '2.2'], action: '', verify: '', done: '' },
    ]
    const plan = planBatches(tasks)
    expect(plan.batches).toHaveLength(3)
    expect(plan.batches[0].tasks.map(t => t.id).sort()).toEqual(['1.1', '1.2'])
    expect(plan.batches[1].tasks.map(t => t.id).sort()).toEqual(['2.1', '2.2'])
    expect(plan.batches[2].tasks.map(t => t.id)).toEqual(['3.1'])
  })
})

describe('parseTasks', () => {
  it('parses tasks from markdown', () => {
    const markdown = `# Tasks for add-auth

## Batch 1 (no dependencies)

### Task 1.1: Create auth models
- **Files**: src/auth/model.ts, src/auth/types.ts
- **Action**: Create Prisma models for User and Session
- **Verify**: Models compile and migrate
- **Done**: User and Session models exist with all fields

### Task 1.2: Create auth middleware
- **Files**: src/middleware/auth.ts
- **Action**: Create JWT verification middleware
- **Verify**: Middleware rejects invalid tokens
- **Done**: Middleware exported and typed

## Batch 2 (depends on Batch 1)

### Task 2.1: Build auth API
- **Depends on**: Task 1.1, Task 1.2
- **Files**: src/app/api/auth/route.ts
- **Action**: Implement login and register endpoints
- **Verify**: Endpoints return correct status codes
- **Done**: Login and register work end-to-end
`
    const tasks = parseTasks(markdown)
    expect(tasks).toHaveLength(3)

    expect(tasks[0].id).toBe('1.1')
    expect(tasks[0].name).toBe('Create auth models')
    expect(tasks[0].files).toEqual(['src/auth/model.ts', 'src/auth/types.ts'])
    expect(tasks[0].depends_on).toEqual([])
    expect(tasks[0].action).toContain('Prisma models')

    expect(tasks[1].id).toBe('1.2')
    expect(tasks[1].files).toEqual(['src/middleware/auth.ts'])

    expect(tasks[2].id).toBe('2.1')
    expect(tasks[2].depends_on).toEqual(['1.1', '1.2'])
  })

  it('handles empty markdown', () => {
    const tasks = parseTasks('')
    expect(tasks).toEqual([])
  })
})
