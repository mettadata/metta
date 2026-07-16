import { describe, it, expect } from 'vitest'
import { parseTasks } from '../src/planning/batch-planner.js'

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
