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
  ]
}
