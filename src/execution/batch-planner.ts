export interface TaskDefinition {
  id: string
  name: string
  files: string[]
  depends_on: string[]
  action: string
  verify: string
  done: string
}

export interface BatchPlan {
  batches: Array<{
    id: number
    tasks: TaskDefinition[]
    parallel: boolean
  }>
}

export function planBatches(tasks: TaskDefinition[]): BatchPlan {
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  const completed = new Set<string>()
  const batches: BatchPlan['batches'] = []
  let batchId = 1

  while (completed.size < tasks.length) {
    const ready = tasks.filter(
      t => !completed.has(t.id) && t.depends_on.every(d => completed.has(d)),
    )

    if (ready.length === 0) {
      const remaining = tasks.filter(t => !completed.has(t.id)).map(t => t.id)
      throw new Error(`Circular dependency detected among tasks: ${remaining.join(', ')}`)
    }

    // Check for file overlap to determine if batch can run in parallel
    const parallel = !hasFileOverlap(ready)

    batches.push({
      id: batchId++,
      tasks: ready,
      parallel,
    })

    for (const task of ready) {
      completed.add(task.id)
    }
  }

  return { batches }
}

function hasFileOverlap(tasks: TaskDefinition[]): boolean {
  const seenFiles = new Set<string>()
  for (const task of tasks) {
    for (const file of task.files) {
      // Normalize: strip backticks and whitespace
      const normalized = file.replace(/`/g, '').trim()
      if (!normalized) continue

      // Check exact match
      if (seenFiles.has(normalized)) return true

      // Check glob/directory overlap: if one task touches src/api/ and
      // another touches src/api/routes.ts, they overlap
      for (const seen of seenFiles) {
        if (normalized.startsWith(seen + '/') || seen.startsWith(normalized + '/')) {
          return true
        }
      }

      seenFiles.add(normalized)
    }
  }
  return false
}

export interface OverlapReport {
  overlapping: Array<{ taskA: string; taskB: string; files: string[] }>
  safe: string[]
}

export function detectOverlaps(tasks: TaskDefinition[]): OverlapReport {
  const overlapping: OverlapReport['overlapping'] = []
  const involvedTasks = new Set<string>()

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const shared = findSharedFiles(tasks[i].files, tasks[j].files)
      if (shared.length > 0) {
        overlapping.push({
          taskA: tasks[i].id,
          taskB: tasks[j].id,
          files: shared,
        })
        involvedTasks.add(tasks[i].id)
        involvedTasks.add(tasks[j].id)
      }
    }
  }

  const safe = tasks.filter(t => !involvedTasks.has(t.id)).map(t => t.id)
  return { overlapping, safe }
}

function findSharedFiles(filesA: string[], filesB: string[]): string[] {
  const shared: string[] = []
  for (const a of filesA) {
    const na = a.replace(/`/g, '').trim()
    if (!na) continue
    for (const b of filesB) {
      const nb = b.replace(/`/g, '').trim()
      if (!nb) continue
      if (na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/')) {
        shared.push(na)
      }
    }
  }
  return shared
}

export function parseTasks(markdown: string): TaskDefinition[] {
  const tasks: TaskDefinition[] = []
  const lines = markdown.split('\n')
  let currentTask: Partial<TaskDefinition> | null = null

  for (const line of lines) {
    // Match both formats:
    //   ### Task 1.1: name        (old format)
    //   - [ ] **Task 1.1: name**  (checklist format)
    //   - [x] **Task 1.1: name**  (completed checklist)
    const taskMatch = line.match(/^(?:###\s+Task|^-\s+\[[ x]\]\s+\*\*Task)\s+(\d+\.\d+):\s*(.+?)(?:\*\*)?$/)
    if (taskMatch) {
      if (currentTask && currentTask.id) {
        tasks.push(currentTask as TaskDefinition)
      }
      currentTask = {
        id: taskMatch[1],
        name: taskMatch[2],
        files: [],
        depends_on: [],
        action: '',
        verify: '',
        done: '',
      }
      continue
    }

    if (!currentTask) continue

    const filesMatch = line.match(/^\s*-\s+\*\*Files\*\*:\s*(.+)/)
    if (filesMatch) {
      currentTask.files = filesMatch[1].split(',').map(f => f.trim())
      continue
    }

    const dependsMatch = line.match(/^\s*-\s+\*\*Depends on\*\*:\s*(.+)/)
    if (dependsMatch) {
      currentTask.depends_on = dependsMatch[1]
        .split(',')
        .map(d => d.trim().replace(/^Task\s+/, ''))
      continue
    }

    const actionMatch = line.match(/^\s*-\s+\*\*Action\*\*:\s*(.+)/)
    if (actionMatch) {
      currentTask.action = actionMatch[1]
      continue
    }

    const verifyMatch = line.match(/^\s*-\s+\*\*Verify\*\*:\s*(.+)/)
    if (verifyMatch) {
      currentTask.verify = verifyMatch[1]
      continue
    }

    const doneMatch = line.match(/^\s*-\s+\*\*Done\*\*:\s*(.+)/)
    if (doneMatch) {
      currentTask.done = doneMatch[1]
      continue
    }
  }

  if (currentTask && currentTask.id) {
    tasks.push(currentTask as TaskDefinition)
  }

  return tasks
}

/**
 * Mark a task as complete in the tasks.md checklist.
 * Replaces `- [ ] **Task X.X:` with `- [x] **Task X.X:`
 */
export function markTaskComplete(markdown: string, taskId: string): string {
  // Match both `- [ ] **Task 1.1:` format
  const pattern = new RegExp(`^(\\s*- )\\[ \\]( \\*\\*Task ${taskId.replace('.', '\\.')}:)`, 'm')
  return markdown.replace(pattern, '$1[x]$2')
}

/**
 * Check which tasks are completed in the tasks.md checklist.
 */
export function getCompletedTasks(markdown: string): string[] {
  const completed: string[] = []
  const pattern = /- \[x\] \*\*Task (\d+\.\d+):/g
  let match
  while ((match = pattern.exec(markdown)) !== null) {
    completed.push(match[1])
  }
  return completed
}
