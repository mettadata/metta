/**
 * Workflow primer text emitted into CLAUDE.md. Two variants:
 * - "short": scaffold use (metta init / install). Single mandate line + three entry points.
 * - "long": authoritative regeneration use (metta refresh). Adds "Forbidden" subsection with
 *   full CLI-call prohibition list and the humans-at-terminal scope caveat.
 *
 * The mandate sentence is identical across both variants so downstream CLAUDE.md consumers
 * see consistent wording regardless of which generator ran last.
 */

const MANDATE =
  '**AI orchestrators MUST invoke the matching metta skill — never call the CLI directly.** ' +
  '(Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)'

const ENTRY_POINTS_BULLETS = [
  '- `/metta-quick <description>` — small, scoped fixes (bug fixes, one-file edits, tiny refactors)',
  '- `/metta-propose <description>` — anything non-trivial (new features, multi-file changes, API surface changes)',
  '- `/metta-fix-issues <slug>` — resolve a logged issue from `spec/issues/`',
]

export function workflowPrimerShort(): string[] {
  return [
    '### How to work',
    '',
    MANDATE,
    '',
    'Primary entry points:',
    ...ENTRY_POINTS_BULLETS,
    '',
    'Run `metta refresh` for the full command reference.',
  ]
}

export function workflowPrimerLong(): string[] {
  return [
    '### How to work',
    '',
    MANDATE + ' The skills wrap artifact authoring, review, and verification with the correct subagent personas; calling the CLI directly bypasses those guarantees and has shipped broken artifacts (see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`).',
    '',
    'Primary entry points:',
    ...ENTRY_POINTS_BULLETS,
    '',
    'Doc-only fixes and edits to this workflow section itself are the exceptions.',
    '',
    '### Forbidden',
    '',
    '- Invoking `metta quick`, `metta propose`, `metta finalize`, `metta complete`, `metta issue`, or any other `metta <cmd>` directly from an AI orchestrator session. Use the matching skill.',
    '- Writing placeholder content like `"intent stub"` or `"summary stub"` to any artifact file to satisfy `metta complete`. Artifacts must carry real content authored by the matching `metta-*` subagent.',
    '',
    '### Research discipline',
    '',
    'When a research-phase or design-phase question has a deterministic answer in public documentation — framework API docs, library reference, CLI tool manual, language spec, SDK changelog — the orchestrator MUST use `WebFetch` (for a known authoritative URL) or `WebSearch` (to discover the authoritative source) to resolve it **before** asking the user. This specifically covers questions about external framework / API / tool documented behavior (e.g. "does Claude Code support `context: fork` in skill frontmatter?", "what fields does the Anthropic Messages API accept?", "is the `--legacy-peer-deps` flag deprecated in npm 10?").',
    '',
    'Only escalate to the user for **subjective judgments** — scope boundaries, cost tradeoffs, product direction, approach choice between acceptable alternatives, risk acceptance. Never escalate a documented fact.',
    '',
    'Cite the source URL when presenting findings so the user can verify the answer.',
  ]
}
