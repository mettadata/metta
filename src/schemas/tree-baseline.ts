import { z } from 'zod'

/**
 * A single entry from `git status --porcelain=v1 -z --untracked-files=no`.
 */
export const TreeEntrySchema = z.object({
  /** Repo-relative path, as reported by porcelain. */
  path: z.string(),
  /** Two-character XY porcelain v1 status code, e.g. ' M', 'MM', 'R '. */
  status: z.string().length(2),
  /** Original path from the second field of `-z` rename/copy records. */
  renamed_from: z.string().optional(),
}).strict()

/**
 * Write-once snapshot of the MAIN checkout's tracked-file dirt, captured
 * before implementation execution begins for a worktree-hosted change.
 * Stored at `<mainRoot>/.metta/scratch/tree-baselines/<change>.yaml`.
 */
export const MainTreeBaselineSchema = z.object({
  /** Change slug (also the filename key). */
  change: z.string(),
  /** Absolute main-checkout root at capture time. */
  main_root: z.string(),
  recorded_at: z.string().datetime(),
  entries: z.array(TreeEntrySchema),
}).strict()

export type TreeEntry = z.infer<typeof TreeEntrySchema>
export type MainTreeBaseline = z.infer<typeof MainTreeBaselineSchema>
