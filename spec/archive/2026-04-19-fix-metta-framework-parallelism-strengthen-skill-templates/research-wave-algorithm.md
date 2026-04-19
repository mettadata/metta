# Research: Parallel Wave Computation Algorithm for `metta tasks plan`

**Change:** fix-metta-framework-parallelism-strengthen-skill-templates
**Date:** 2026-04-19
**Scope:** Algorithm selection for `src/planning/parallel-wave-computer.ts`

---

## Context

The `metta tasks plan` command reads a `tasks.md` file and must output a wave plan
that groups tasks into parallel execution waves. The actual `tasks.md` format, as
observed in the shipped `adaptive-workflow-tier-selection-emit-complexity-score-after`
archive, has two structural signals that the algorithm can consume:

1. **Batch headers** (`## Batch 1 (no dependencies)`, `## Batch 2 (depends on Batch 1)`, etc.) —
   coarse grouping imposed by the author, usually matching a narrative dependency level.
2. **Per-task `Files` field** — a markdown list of file paths declared inline in each
   task block (e.g., `src/schemas/change-metadata.ts`, `tests/schemas.test.ts`).
3. **Per-task `Depends on` field** — an optional line naming one or more task IDs
   by number (e.g., `- **Depends on**: Task 1.1`).

The pure module must accept `{ id: string; files: string[] }[]` and return `Wave[]`.
The spec (`ParallelWaveAlgorithm` requirement) is explicit: file-overlap creates edges;
connected components form sequential groups; tasks across components that have no
edges to each other can go into the same parallel wave; `Depends on` directives must
also be respected by placing dependent tasks in later waves.

---

## Algorithm 1: Connected-Components on File-Overlap Graph

### Description

Build an undirected graph where nodes are task IDs and an edge exists between any
two tasks that declare at least one identical file path. Use union-find (or BFS/DFS)
to identify connected components. Each component is a clique of tasks that must run
sequentially relative to each other (they share files). Components that are isolated
from each other have no ordering constraint and can be placed in the same wave.

To produce multiple waves within a component (instead of one-task-per-wave), order
tasks inside a component by their natural document order and emit one per wave step.

**Wave emission rule:** Wave N contains the set of tasks that are either (a) the
leading unstarted task in each component, or (b) members of isolated singleton
components not yet emitted.

### Pros

- Directly matches the spec wording: "build a task graph where tasks sharing any
  file path are connected by an edge; compute connected components."
- Simple to implement and reason about — union-find is O(N alpha(N)).
- Pure function with no I/O: takes `{ id, files }[]`, returns `Wave[]`.
- Handles the dominant real-world case (the `tasks.md` format uses explicit `Files`
  fields as the primary signal) without requiring a secondary `Depends on` parse.
- Easy to unit-test: enumerate components, assert wave membership.

### Cons

- Ignores `Depends on` declarations entirely; two tasks with disjoint files but an
  explicit dependency would be incorrectly placed in the same wave.
- Requires a secondary pass or a wrapper to handle `Depends on` when present.
- Within a component, the sequential ordering among tasks is determined by document
  order, not by any finer structural signal. This is usually correct but is implicit.
- Does not distinguish between "task A must finish before task B" and "task A and
  task B merely share a file but could still run in parallel if the file access is
  read-only." This over-serializes in the conservative direction, which is safe.

---

## Algorithm 2: Topological Sort Honoring `Depends on` Declarations

### Description

Build a directed acyclic graph (DAG) from explicit `Depends on` directives only.
For each task that declares `Depends on: Task X`, add a directed edge X -> current.
Run Kahn's algorithm (BFS-based topological sort) to assign each task a level number.
Tasks at level 0 have no declared prerequisites; tasks at level 1 depend on at least
one level-0 task; and so on. Each level becomes a wave.

File-overlap is ignored unless a `Depends on` directive codifies it.

### Pros

- Precise: only tasks with genuine declared sequencing constraints are separated.
- Produces the minimum number of waves for any given dependency graph.
- Kahn's algorithm is O(V + E) and trivially implementable.
- Topological levels are unambiguous and authoritatively driven by the spec author.

### Cons

- Completely ignores file-overlap. Two tasks that both write to the same file but
  lack a `Depends on` link will be placed in the same wave and run in parallel,
  causing a race condition or file corruption at the tool-call layer.
- The actual `tasks.md` format used in this project often omits `Depends on` within
  a batch (e.g., all five Batch 1 tasks in the observed archive have no `Depends on`
  field, relying entirely on batch-level separation). This algorithm would then place
  all five in Wave 1 regardless of any shared files -- which may be correct for
  Batch 1 but is dangerous for later batches where the batch header says "depends
  on Batch 1" and individual tasks may share files among themselves.
- The spec requirement (`ParallelWaveAlgorithm`) lists file-overlap as the primary
  mechanism; `Depends on` is additive. A pure toposort algorithm inverts this
  priority.
- Detecting cycles requires explicit handling; malformed `tasks.md` with circular
  references needs a graceful error path.

---

## Algorithm 3: Combined -- Components-then-Toposort

### Description

Two-pass algorithm:

**Pass 1 (file-overlap):** Build an undirected file-overlap graph, compute connected
components using union-find. Each component is a candidate sequential chain.

**Pass 2 (dependency overlay):** For each `Depends on` directive, inspect whether
the dependency already creates an intra-component ordering (fine — union-find already
handles this) or a cross-component ordering. For cross-component dependencies, add a
directed edge between the two components in a component-level DAG. Run topological
sort on the component DAG to determine the inter-component ordering.

**Wave emission:** Walk the component-level topological order. Within each component,
emit tasks one per wave step in document order (since all tasks in the same component
share at least one file). Components that are at the same topological level and have
no cross-component dependency edges are placed into the same wave.

### Pros

- Satisfies both signals: file-overlap within a component; `Depends on` across
  components.
- Matches the spec's `ParallelWaveAlgorithm` description exactly, which explicitly
  mentions both mechanisms.
- Correctly handles the observed `tasks.md` format where `Depends on` is used only
  across batches (i.e., "depends on Batch 1" tasks implicitly depend on all Batch 1
  tasks, but the per-task `Depends on` field uses specific task IDs).
- The two passes are independently testable.

### Cons

- More complex than either standalone algorithm: union-find plus DAG plus toposort.
- Two-level abstraction (task graph and component graph) requires careful bookkeeping
  when emitting waves -- a task's wave number depends on both its position in its
  component chain and the component's level in the component DAG.
- The spec's JSON output shape (`batches[].waves[].tasks`) suggests flat wave arrays,
  not a nested component structure, so the two-level internal model must be flattened
  before output. This is straightforward but adds a serialization step.
- In practice, `Depends on` cross-component edges are rare in observed `tasks.md`
  files (the batch header handles most inter-batch ordering); the added complexity
  may not pay off for the common case.

---

## Tradeoff Table

| Criterion                          | Algorithm 1 (Components) | Algorithm 2 (Toposort) | Algorithm 3 (Combined) |
|------------------------------------|:------------------------:|:----------------------:|:----------------------:|
| Spec requirement fidelity          | High                     | Medium                 | Highest                |
| Implementation complexity          | Low                      | Low                    | Medium                 |
| Handles file-overlap correctly     | Yes                      | No                     | Yes                    |
| Handles `Depends on` correctly     | No                       | Yes                    | Yes                    |
| Safe default (over-serialize)      | Yes                      | No                     | Yes                    |
| Consistent with observed format    | Yes                      | Partial                | Yes                    |
| Unit-testable as pure function     | Yes                      | Yes                    | Yes                    |
| Wave count minimized               | Good                     | Optimal                | Good                   |
| Cycle detection required           | No                       | Yes                    | Yes (component DAG)    |
| Lines of implementation (estimate) | ~60                      | ~60                    | ~120                   |

---

## Recommendation

**Use Algorithm 3: Combined (components-then-toposort).**

The spec (`ParallelWaveAlgorithm` requirement) explicitly mandates both signals:
"build a task graph where tasks sharing any file path are connected by an edge;
compute connected components... For components with declared `Depends on` directives,
the algorithm MUST respect those directives and place dependent tasks in later waves."
This dual mandate rules out Algorithm 1 (drops `Depends on`) and Algorithm 2
(drops file-overlap). Algorithm 3 is the only approach that satisfies both without
compromise. The implementation complexity is bounded: union-find is a well-understood
20-line primitive, and Kahn's algorithm on a component DAG with at most N/1 nodes is
equally compact. The practical size of `tasks.md` files in this project (5-15 tasks
per batch, 2-5 batches per change) means the two-pass overhead is negligible. The
combined approach also produces the safest default behavior: it over-serializes when
in doubt (file conflict forces sequencing) while permitting true parallelism between
components, which is the observable value the command exists to surface. Algorithm 1
is the acceptable fallback for an MVP if `Depends on` cross-component edges are
genuinely absent in practice, but it would require a follow-up pass anyway once the
first edge appears.

---

## Pseudocode: Algorithm 3 (Combined)

```
function computeWaves(tasks: { id: string; files: string[]; dependsOn?: string[] }[]): Wave[] {

  // --- Pass 1: union-find on file overlap ---
  const parent = new Map<string, string>()  // task id -> root id

  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }

  function union(x: string, y: string): void {
    const rx = find(x), ry = find(y)
    if (rx !== ry) parent.set(rx, ry)
  }

  for (const task of tasks) parent.set(task.id, task.id)

  // Build file -> task index
  const fileOwners = new Map<string, string[]>()
  for (const task of tasks) {
    for (const f of task.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, [])
      fileOwners.get(f)!.push(task.id)
    }
  }

  // Union all tasks that share a file
  for (const owners of fileOwners.values()) {
    for (let i = 1; i < owners.length; i++) union(owners[0], owners[i])
  }

  // Group tasks by component root
  const components = new Map<string, string[]>()  // root -> [task ids in document order]
  for (const task of tasks) {
    const root = find(task.id)
    if (!components.has(root)) components.set(root, [])
    components.get(root)!.push(task.id)
  }

  // --- Pass 2: component-level DAG from Depends On ---
  const taskToRoot = new Map<string, string>()
  for (const task of tasks) taskToRoot.set(task.id, find(task.id))

  // componentEdges: root -> Set<root> (cross-component directed edges)
  const componentEdges = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const root of components.keys()) {
    componentEdges.set(root, new Set())
    inDegree.set(root, 0)
  }

  for (const task of tasks) {
    const toRoot = taskToRoot.get(task.id)!
    for (const depId of (task.dependsOn ?? [])) {
      const fromRoot = taskToRoot.get(depId)
      if (fromRoot && fromRoot !== toRoot) {
        // Cross-component dependency: depId's component must finish before task's component
        if (!componentEdges.get(fromRoot)!.has(toRoot)) {
          componentEdges.get(fromRoot)!.add(toRoot)
          inDegree.set(toRoot, (inDegree.get(toRoot) ?? 0) + 1)
        }
      }
    }
  }

  // Kahn's topological sort on component DAG -> levels
  const queue: string[] = []
  for (const [root, deg] of inDegree) {
    if (deg === 0) queue.push(root)
  }

  const componentLevel = new Map<string, number>()
  let head = 0
  while (head < queue.length) {
    const root = queue[head++]
    const level = componentLevel.get(root) ?? 0
    for (const neighbor of componentEdges.get(root)!) {
      componentLevel.set(neighbor, Math.max(componentLevel.get(neighbor) ?? 0, level + 1))
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1)
      if (inDegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }

  // --- Wave emission ---
  // Each component emits its tasks one per wave, starting at the component's level.
  // Tasks at the same absolute wave number across components run in parallel.

  const waveMap = new Map<number, string[]>()  // wave number -> [task ids]

  for (const [root, taskIds] of components) {
    const baseLevel = componentLevel.get(root) ?? 0
    taskIds.forEach((id, i) => {
      const waveNum = baseLevel + i
      if (!waveMap.has(waveNum)) waveMap.set(waveNum, [])
      waveMap.get(waveNum)!.push(id)
    })
  }

  // Sort and flatten
  const sortedWaveNums = [...waveMap.keys()].sort((a, b) => a - b)
  return sortedWaveNums.map((n, i) => ({
    label: `Wave ${i + 1}`,
    mode: waveMap.get(n)!.length > 1 ? 'parallel' : 'sequential',
    tasks: waveMap.get(n)!,
  }))
}
```

**Key properties of this pseudocode:**
- No I/O: pure function over its input.
- Union-find with path compression: O(N alpha(N)) for the file-overlap pass.
- Kahn's algorithm: O(V + E) on the component DAG.
- Cycle detection: if `queue` drains before all components are visited, a cycle exists
  in the `Depends on` graph; the implementation should throw a descriptive error
  naming the involved task IDs.
- Wave numbering is contiguous after sorting; the `label` is re-indexed to `Wave 1`,
  `Wave 2`, etc. regardless of internal numbering gaps.
- The `mode` field is `'parallel'` when more than one task occupies the same wave
  and `'sequential'` when only one task is present (matching the JSON shape in the
  `TasksPlanJsonOutput` requirement).
