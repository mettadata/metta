// Activation-path helper: the exact `metta propose "<title>"` handoff fragment
// that `roadmap next` prints. `roadmap next` is now the sole consumer —
// `backlog promote` hands off into the fix-issues flow (`/metta-fix-issues
// <slug>`) instead and no longer imports this helper.
export function buildPromoteHandoff(item: { title: string }): string {
  return `metta propose "${item.title}"`
}
