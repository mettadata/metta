# Research: custom-claude-statusline-conte

## Decision: Tail-read transcript for context %; mirror `installMettaGuardHook` pattern for install wiring

Two parallel investigations were conducted — one on Claude Code's stdin/transcript contracts and one on the install-time registration pattern.

### Approaches Considered

1. **Transcript tail-read + mirrored install helper** (selected) — read the last 64 KB of `transcript_path` and reverse-scan for the most recent assistant turn with a `message.usage.input_tokens` number; add an `installMettaStatusline(root)` helper alongside `installMettaGuardHook(root)` in `src/cli/commands/install.ts`, and extend the `copy-templates` script in `package.json` with one additional `cp -r src/templates/statusline dist/templates/statusline` line.
2. **Whole-file transcript read + colocated template in `src/templates/hooks/`** — simpler read (and fine for typical <5 MB sessions), and no `package.json` edit needed if the script sits next to `metta-guard-edit.mjs`. Rejected because: (a) the discovery decision committed to `src/templates/statusline/` as its own directory, matching the separation of concerns with hooks; (b) large or long-running sessions can grow transcripts into the tens of MB and a tail read is O(1) regardless of size with negligible added complexity; (c) every statusline tick is on the synchronous path for UI updates, so bounded I/O is worth the small code cost.
3. **Read `context_window.used_percentage` directly from stdin** — Claude Code already exposes a precomputed percentage field in the stdin payload. Rejected because the spec explicitly requires transcript-derived numerics and the exposed field semantics (cache-inclusive vs. input-only) are not documented well enough to rely on for a spec guarantee; deriving from `input_tokens` keeps the math transparent and testable.

### Rationale

**Transcript parsing.** The Claude Code statusline stdin payload is a JSON object with at minimum these fields (confirmed against `https://code.claude.com/docs/en/statusline`, accessed 2026-04-16, and a live local transcript at `/home/utx0/.claude/projects/-home-utx0-Code-metta/*.jsonl`):

- `transcript_path: string` — absolute path to the session's JSONL file.
- `model: { id: string, display_name: string }` — **an object, not a string**. The context-window decision MUST inspect `model.id` for the `[1m]` substring. The spec's existing wording treats `model` as a string; the implementation MUST read `model?.id` and the spec SHOULD be understood to mean `model.id` in its `[1m]` rule.

Within the transcript JSONL, the relevant path for an assistant turn is `record.message.role === 'assistant'` and `record.message.usage.input_tokens: number`. The `usage` block also carries `cache_read_input_tokens` and `cache_creation_input_tokens` — both of which physically occupy the context window. **Per spec, only `input_tokens` is used**, which undercounts true fill when a large cache is in use. This is a deliberate, documented simplification; a follow-up change can widen the formula if the undercount proves misleading in practice.

Tail-read strategy: `fs.open`, `fstat` for size, `read` the last `min(65536, size)` bytes into a buffer, drop the (possibly partial) first line, split on `\n`, iterate **in reverse**, and select the first record where `message.role === 'assistant'` AND `message.usage.input_tokens` is a number. If the reverse scan exhausts the tail without a match, omit the `%` segment from the output — do not fabricate `0%`.

**Install wiring.** The correct Claude Code `settings.json` shape for a statusline entry (confirmed from the same docs source) is:

```json
{
  "statusLine": {
    "type": "command",
    "command": ".claude/statusline/statusline.mjs",
    "padding": 0
  }
}
```

`statusLine` lives at the top level, not nested under `hooks`. `type` is always `"command"`. `padding` is optional (0 default). A relative path from the project root is portable and matches the convention used by the existing `metta-guard-edit.mjs` registration.

The install helper is a near-clone of `installMettaGuardHook` with three structural differences: (1) a single top-level object key (`statusLine`) rather than array surgery on `PreToolUse`; (2) a warn-and-skip policy when a foreign `statusLine` command string is present (rather than silently merging alongside), so users who wrote their own statusline are not clobbered; (3) no `matcher` field, since `statusLine` has no event filter concept.

Build pipeline: `package.json`'s `copy-templates` script uses an explicit `cp -r` per subdirectory — no glob. Because discovery committed to `src/templates/statusline/` as its own directory, one new line must be added: `cp -r src/templates/statusline dist/templates/statusline`.

### Key Implementation Constants

| Item | Value |
|---|---|
| Template source | `src/templates/statusline/statusline.mjs` |
| Installed path (relative, in settings.json) | `.claude/statusline/statusline.mjs` |
| File mode after copy | `0o755` |
| `settings.json` key | top-level `statusLine` |
| Context window — default | `200_000` |
| Context window — when `model.id` contains `[1m]` | `1_000_000` |
| Transcript tail read size | `65_536` bytes |
| `metta status --json` subprocess timeout | `5_000` ms |

### Spec Corrections Noted

- **`model` is an object** `{id, display_name}`. Implementation must read `model?.id`. The spec's `[1m]` substring test is logically correct but the field access path needs to target `model.id`, not `model`.
- **No other corrections required.** The spec's other requirements (failure contract, idempotent merge, exit code 0, deterministic color from change slug) all survive the research without modification.

### Artifacts Produced

None beyond this note — the research answers point directly into the forthcoming `design.md` and `tasks.md`. No separate API contract, schema, or diagram files are warranted for a single-script feature of this size.

### Sources

- https://code.claude.com/docs/en/statusline (stdin schema, `statusLine` settings.json shape) — accessed 2026-04-16
- `/home/utx0/.claude/projects/-home-utx0-Code-metta/*.jsonl` — empirical confirmation of transcript record shape
- `src/cli/commands/install.ts` — reference for `installMettaGuardHook` pattern
- `package.json` `copy-templates` script — confirms explicit-per-directory copy (no glob)
- https://github.com/anthropics/claude-code/issues/24147 — confirms cache tokens consume context quota (supports follow-up consideration)
