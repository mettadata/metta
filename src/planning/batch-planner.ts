export interface TaskDefinition {
  id: string
  name: string
  files: string[]
  depends_on: string[]
  action: string
  verify: string
  done: string
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
