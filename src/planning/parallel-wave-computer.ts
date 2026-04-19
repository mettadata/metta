/**
 * parallel-wave-computer: pure planner that converts a TaskGraph (batches of
 * tasks with file lists and `dependsOn` edges) into a WavePlan where each wave
 * is a set of tasks that may run in parallel.
 *
 * Algorithm, per batch (batches are independent):
 *   1. Build file -> task map from task.files.
 *   2. Union-find: tasks sharing any file are merged into a file-overlap
 *      cluster. Sequential ordering is enforced within a cluster.
 *   3. Apply `dependsOn` edges as additional ordering constraints on the
 *      task-level DAG (both within and across clusters).
 *   4. Level-schedule tasks using Kahn's algorithm:
 *      - A task is ready when all its dependencies are scheduled AND every
 *        other task in its cluster with earlier ordering has been scheduled.
 *   5. Emit each level as a wave:
 *      - mode='parallel' when the wave has 2+ tasks from 2+ distinct clusters.
 *      - mode='sequential' otherwise (single task, or multiple tasks from one
 *        cluster).
 *   6. Throws on dependency cycles with the involved task IDs.
 *
 * Wave numbering is global across the whole plan (Wave 1, Wave 2, ...).
 *
 * Tasks with missing/empty `files` are treated as file-disjoint and get their
 * own singleton cluster.
 */

export type TaskId = string

export interface Task {
  id: TaskId
  files: string[]
  dependsOn: TaskId[]
}

export interface Batch {
  batch: number
  label: string
  tasks: Task[]
}

export interface TaskGraph {
  batches: Batch[]
}

export interface Wave {
  wave: string
  mode: 'parallel' | 'sequential'
  tasks: TaskId[]
}

export interface BatchPlan {
  batch: number
  label: string
  waves: Wave[]
}

export interface WavePlan {
  change: string
  batches: BatchPlan[]
}

/** Union-find with path compression and union by rank. */
class UnionFind {
  private parent = new Map<string, string>()
  private rank = new Map<string, number>()

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
  }

  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.add(x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    const rankA = this.rank.get(ra) ?? 0
    const rankB = this.rank.get(rb) ?? 0
    if (rankA < rankB) {
      this.parent.set(ra, rb)
    } else if (rankA > rankB) {
      this.parent.set(rb, ra)
    } else {
      this.parent.set(rb, ra)
      this.rank.set(ra, rankA + 1)
    }
  }
}

function computeBatchPlan(batch: Batch, waveStart: number): { plan: BatchPlan; wavesConsumed: number } {
  const tasks = batch.tasks
  const byId = new Map<TaskId, Task>()
  for (const t of tasks) byId.set(t.id, t)

  // 1. File -> tasks and union-find clustering
  const uf = new UnionFind()
  for (const t of tasks) uf.add(t.id)

  const fileToTasks = new Map<string, TaskId[]>()
  for (const t of tasks) {
    const files = t.files ?? []
    for (const f of files) {
      let list = fileToTasks.get(f)
      if (!list) {
        list = []
        fileToTasks.set(f, list)
      }
      list.push(t.id)
    }
  }
  for (const [, ids] of fileToTasks) {
    for (let i = 1; i < ids.length; i++) {
      uf.union(ids[0], ids[i])
    }
  }

  const clusterOf = new Map<TaskId, string>()
  for (const t of tasks) clusterOf.set(t.id, uf.find(t.id))

  // 2. Build task-level dependency edges:
  //    - Explicit dependsOn edges (only when target is in this batch).
  //    - Intra-cluster sequential edges: tasks in the same cluster are ordered
  //      by (existing dependsOn chain, then alphabetical id) so they emit one
  //      per wave.
  const deps = new Map<TaskId, Set<TaskId>>()
  for (const t of tasks) deps.set(t.id, new Set())

  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (byId.has(dep)) {
        deps.get(t.id)!.add(dep)
      }
    }
  }

  // Group tasks by cluster and add sequential edges between consecutive tasks
  // (sorted alphabetically by id, stable tiebreak).
  const clusterMembers = new Map<string, TaskId[]>()
  for (const t of tasks) {
    const c = clusterOf.get(t.id)!
    let list = clusterMembers.get(c)
    if (!list) {
      list = []
      clusterMembers.set(c, list)
    }
    list.push(t.id)
  }
  for (const [, members] of clusterMembers) {
    if (members.length <= 1) continue
    // Sort by id for a deterministic sequential chain; dependsOn edges still
    // win because Kahn's algorithm honors them too.
    const sorted = [...members].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (let i = 1; i < sorted.length; i++) {
      deps.get(sorted[i])!.add(sorted[i - 1])
    }
  }

  // 3. Kahn's algorithm with level scheduling.
  const indeg = new Map<TaskId, number>()
  for (const t of tasks) indeg.set(t.id, deps.get(t.id)!.size)

  const reverse = new Map<TaskId, TaskId[]>()
  for (const t of tasks) reverse.set(t.id, [])
  for (const [id, ds] of deps) {
    for (const d of ds) {
      reverse.get(d)!.push(id)
    }
  }

  const scheduled = new Set<TaskId>()
  const waves: Wave[] = []
  let wavesConsumed = 0

  while (scheduled.size < tasks.length) {
    const ready: TaskId[] = []
    for (const t of tasks) {
      if (scheduled.has(t.id)) continue
      if ((indeg.get(t.id) ?? 0) === 0) ready.push(t.id)
    }
    if (ready.length === 0) {
      // Cycle detected — collect unscheduled task IDs.
      const unscheduled = tasks.filter((t) => !scheduled.has(t.id)).map((t) => t.id)
      throw new Error(
        `Dependency cycle detected among tasks: ${unscheduled.join(', ')}`,
      )
    }

    ready.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    const clustersInWave = new Set(ready.map((id) => clusterOf.get(id)!))
    const mode: 'parallel' | 'sequential' =
      ready.length >= 2 && clustersInWave.size >= 2 ? 'parallel' : 'sequential'

    wavesConsumed += 1
    waves.push({
      wave: `Wave ${waveStart + wavesConsumed - 1}`,
      mode,
      tasks: ready,
    })

    for (const id of ready) {
      scheduled.add(id)
    }
    for (const id of ready) {
      for (const child of reverse.get(id) ?? []) {
        indeg.set(child, (indeg.get(child) ?? 0) - 1)
      }
    }
  }

  return {
    plan: { batch: batch.batch, label: batch.label, waves },
    wavesConsumed,
  }
}

export function computeWaves(graph: TaskGraph, changeName: string): WavePlan {
  const batches: BatchPlan[] = []
  let nextWave = 1
  for (const batch of graph.batches) {
    const { plan, wavesConsumed } = computeBatchPlan(batch, nextWave)
    batches.push(plan)
    nextWave += wavesConsumed
  }
  return { change: changeName, batches }
}
