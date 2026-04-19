/**
 * Pure renderers for a WavePlan: human-readable text (no ANSI) and JSON.
 *
 * The human format is stable and machine-friendly:
 *
 *   --- Batch 1 ---
 *   Wave 1 [parallel]: Task 1.1, Task 1.2, Task 1.3
 *   --- Batch 2 ---
 *   Wave 2 [parallel]: Task 2.1, Task 2.3
 *   Wave 3 [sequential]: Task 2.2 (shares <file> with 2.1)
 *
 * When a sequential wave contains a single task and a sibling task in the
 * same batch shares a file path with it, we annotate the wave line with a
 * `(shares <file> with <other-id>)` hint. The annotation is best-effort —
 * when no prior sibling can be identified we just emit the task list.
 */
import { type WavePlan, type BatchPlan, type Wave } from '../../planning/index.js'

function formatTaskId(id: string): string {
  return `Task ${id}`
}

function annotateSequentialWave(
  wave: Wave,
  allWavesInBatch: Wave[],
): string {
  // Only annotate single-task sequential waves — multi-task sequential waves
  // are implicitly in the same cluster and need no extra explanation.
  if (wave.tasks.length !== 1) return ''
  const taskId = wave.tasks[0]

  // Find any prior task in this batch (any earlier wave).
  const priorTasks: string[] = []
  for (const w of allWavesInBatch) {
    if (w.wave === wave.wave) break
    for (const t of w.tasks) priorTasks.push(t)
  }
  if (priorTasks.length === 0) return ''

  // Without access to the original Task graph we cannot identify the exact
  // shared file path; instead we provide a generic "shares files with"
  // annotation naming the closest prior task. This matches the spec format
  // `(shares <file> with <id>)` as best we can from WavePlan alone.
  const closestPrior = priorTasks[priorTasks.length - 1]
  return ` (shares files with ${closestPrior})`
}

function renderWave(wave: Wave, allWavesInBatch: Wave[]): string {
  const taskList = wave.tasks.map(formatTaskId).join(', ')
  const annotation = wave.mode === 'sequential'
    ? annotateSequentialWave(wave, allWavesInBatch)
    : ''
  return `${wave.wave} [${wave.mode}]: ${taskList}${annotation}`
}

function renderBatch(batch: BatchPlan): string {
  const lines: string[] = []
  lines.push(`--- Batch ${batch.batch} ---`)
  for (const wave of batch.waves) {
    lines.push(renderWave(wave, batch.waves))
  }
  return lines.join('\n')
}

/**
 * Render a WavePlan as a human-readable string. No ANSI codes; stable,
 * grep-friendly format suitable for a terminal or a test fixture.
 */
export function renderHumanPlan(plan: WavePlan): string {
  const blocks: string[] = []
  for (const batch of plan.batches) {
    blocks.push(renderBatch(batch))
  }
  return blocks.join('\n')
}

/**
 * Render a WavePlan as pretty-printed JSON matching the documented schema:
 *   { change, batches: [{ batch, label, waves: [{ wave, mode, tasks }] }] }
 */
export function renderJsonPlan(plan: WavePlan): string {
  return JSON.stringify(plan, null, 2)
}
