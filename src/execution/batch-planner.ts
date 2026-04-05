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
      if (seenFiles.has(file)) return true
      seenFiles.add(file)
    }
  }
  return false
}

export function parseTasks(markdown: string): TaskDefinition[] {
  const tasks: TaskDefinition[] = []
  const lines = markdown.split('\n')
  let currentTask: Partial<TaskDefinition> | null = null

  for (const line of lines) {
    const taskMatch = line.match(/^###\s+Task\s+(\d+\.\d+):\s*(.+)/)
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

    const filesMatch = line.match(/^-\s+\*\*Files\*\*:\s*(.+)/)
    if (filesMatch) {
      currentTask.files = filesMatch[1].split(',').map(f => f.trim())
      continue
    }

    const dependsMatch = line.match(/^-\s+\*\*Depends on\*\*:\s*(.+)/)
    if (dependsMatch) {
      currentTask.depends_on = dependsMatch[1]
        .split(',')
        .map(d => d.trim().replace(/^Task\s+/, ''))
      continue
    }

    const actionMatch = line.match(/^-\s+\*\*Action\*\*:\s*(.+)/)
    if (actionMatch) {
      currentTask.action = actionMatch[1]
      continue
    }

    const verifyMatch = line.match(/^-\s+\*\*Verify\*\*:\s*(.+)/)
    if (verifyMatch) {
      currentTask.verify = verifyMatch[1]
      continue
    }

    const doneMatch = line.match(/^-\s+\*\*Done\*\*:\s*(.+)/)
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
