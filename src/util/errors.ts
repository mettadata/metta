/**
 * Normalize an unknown thrown value into a human-readable message string.
 *
 * Lives in `util/` (dependency-free) so any layer — including core modules —
 * can use it without importing the CLI layer.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
