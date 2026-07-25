// Shared activation-path helper: the exact `metta propose "<title>"` handoff
// fragment that `backlog promote` prints, extracted so `roadmap next` inherits
// the same activation semantics from a single edit point. Any future change to
// promote's handoff automatically applies to both commands.
export function buildPromoteHandoff(item: { title: string }): string {
  return `metta propose "${item.title}"`
}
