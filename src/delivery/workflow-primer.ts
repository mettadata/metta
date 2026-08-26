/**
 * Workflow primer text emitted into CLAUDE.md. Two variants:
 * - "short": scaffold use (metta init / install). Scoped mandate + pointer line + three
 *   entry points.
 * - "long": authoritative regeneration use (metta refresh). Adds the "Forbidden" subsection
 *   enumerating the guard's blocked surface and a "Read-only queries" subsection enumerating
 *   its allowed surface.
 *
 * The mandate scopes the skill requirement to state-mutating metta commands and names the
 * `metta-guard-bash` PreToolUse hook as the enforcement authority. It is a single shared
 * constant so both variants render it byte-identically — an invariant now pinned by test
 * (tests/delivery.test.ts, "Workflow primer scoped mandate").
 *
 * The enumerated allow/block lists below are hand-synced with
 * src/templates/hooks/metta-guard-bash.mjs (and its deployed copy) and guarded by the seam
 * test in tests/delivery.test.ts — drift fails CI.
 */

const MANDATE =
  '**State-mutating metta commands MUST go through the matching metta skill — never as direct CLI calls from an AI orchestrator session.** ' +
  'Enforcement authority is the `metta-guard-bash` PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a read-only query surface directly. ' +
  '(Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)'

const READ_ONLY_POINTER =
  'Read-only queries (`metta status`, `metta progress`, `metta issues list`, …) are permitted directly; the guard fails closed, so attempting a query is always safe.'

// SYNC: mirrors the ALLOWED_SUBCOMMANDS / ALLOWED_TWO_WORD / ALLOWED_BARE lists in
// src/templates/hooks/metta-guard-bash.mjs — edit both together; the seam test in
// tests/delivery.test.ts fails on drift.
const READ_ONLY_SURFACE_BULLETS = [
  '### Read-only queries (permitted directly)',
  '',
  "The `metta-guard-bash` hook allows these directly — no skill needed. This list mirrors the hook's allow-lists at generation time; the hook, not this text, is authoritative:",
  '- Single-word: `status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install` (`iteration`/`model-escalation`/`tokens` append instrumentation records and `install` writes scaffolding — guard-allowed, though not strictly read-only)',
  '- Two-word: `issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`',
  '- Bare (flags only): `roadmap`, `release`, `backlog` (e.g. `metta roadmap --json`)',
  '',
  'Run bare `metta` for the full current command listing. When in doubt about a command not listed here, attempt it — the guard fails closed and blocks anything unrecognized, so an attempt is always safe and never mutates state.',
]

const ENTRY_POINTS_BULLETS = [
  '- `/metta-quick <description>` — small, scoped fixes (bug fixes, one-file edits, tiny refactors)',
  '- `/metta-propose <description>` — anything non-trivial (new features, multi-file changes, API surface changes)',
  '- `/metta-fix-issues <slug>` — resolve a logged issue from `spec/issues/`',
]

const TRUST_MODEL_BULLETS = [
  'Skill authorization is enforced by the `metta-guard-bash` PreToolUse hook via a two-tier trust model:',
  '- **Tier 1 (fork-tier)** — `propose`, `quick`, `auto`, `ship`, `issue`, `fix-issue`: authorized by the caller identity (`agent_type`) the Claude Code runtime attaches when a forked `metta-skill-host` subagent issues the Bash call. The runtime sets this field itself, so it cannot be forged from command text.',
  '- **Tier 2 (session-tier)** — `complete`, `finalize`, `refresh`, `import`, `init`, `fix-gap`, plus the scoped two-word forms `backlog add/done/promote` and `changes abandon`: authorized by per-skill session credentials at `.metta/scratch/skill-session/<slug>.token`. Each credential is minted by `.claude/hooks/metta-session-mint.mjs` when the matching skill is invoked, slide-rotated on active use (re-minted once it passes 80% of its TTL), and stamped with the runtime-supplied session id. During delegation windows where the mint hook cannot fire, the guard itself re-primes a session-bound credential on authorized use, so a live lifecycle keeps working across subagent turns; the effective lifetime is bounded — a credential dies TTL + GRACE after the last mint or re-prime. The credential value is a random server-minted string that never appears in any skill file, so it cannot be derived from reading skill instructions.',
  '- **Emergency bypass (humans/CI)** — disable the guard hook in `.claude/settings.local.json`.',
]

export function workflowPrimerShort(): string[] {
  return [
    '### How to work',
    '',
    MANDATE,
    '',
    READ_ONLY_POINTER,
    '',
    'Primary entry points:',
    ...ENTRY_POINTS_BULLETS,
    '',
    ...TRUST_MODEL_BULLETS,
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
    ...TRUST_MODEL_BULLETS,
    '',
    'Quick mode is the default routing decision for small, bounded changes (single-file edits, typo/text fixes, small self-contained utilities, bug fixes with an obvious localized cause). Choosing or keeping `--workflow standard` or `--workflow full` above the scored recommendation requires a recorded justification — the escalation record written to the change\'s `.metta.yaml`.',
    '',
    'Doc-only fixes and edits to this workflow section itself are the exceptions.',
    '',
    '### Forbidden',
    '',
    // SYNC: mirrors the BLOCKED_SUBCOMMANDS / BLOCKED_TWO_WORD lists in
    // src/templates/hooks/metta-guard-bash.mjs — edit both together; the seam test in
    // tests/delivery.test.ts fails on drift.
    '- Invoking any state-mutating metta command directly from an AI orchestrator session: `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`. Use the matching skill.',
    '- Writing placeholder content like `"intent stub"` or `"summary stub"` to any artifact file to satisfy `metta complete`. Artifacts must carry real content authored by the matching `metta-*` subagent.',
    '',
    ...READ_ONLY_SURFACE_BULLETS,
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
