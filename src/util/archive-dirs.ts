/**
 * True when an archive directory name is an archived change directory.
 *
 * Archived changes are always written as `YYYY-MM-DD-<change-name>` by
 * finalize, so a date prefix is the discriminator. Non-change archive
 * directories (e.g. `spec/archive/backlog-legacy/` created by
 * `metta backlog migrate`) carry no date prefix and must not be treated
 * as completed changes by consumers scanning `spec/archive/` — progress
 * would render them as shipped work and `release cut` would claim them
 * in a release's change list.
 */
export function isArchivedChangeDir(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-/.test(name)
}
