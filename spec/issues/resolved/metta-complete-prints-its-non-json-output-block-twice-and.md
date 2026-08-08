# metta complete prints its non-json output block twice and stories parser rejects **As an** variant

**Captured**: 2026-07-14
**Status**: logged
**Severity**: minor

## Symptom

Two paper cuts in the complete/stories pipeline, observed during the tier-routing change (2026-07-13). First, `METTA_SKILL=1 metta complete intent` (and `complete stories`) prints its completion output block twice back-to-back: the `[METTA-PROPOSER] intent complete / Next: [METTA-PRODUCT] stories` banner appears two times in the terminal. Second, `metta complete stories` rejected a stories.md containing `**As an** AI orchestrator` with `Story US-4 is missing required field: asA`, forcing a reword to `**As a** skill-driven AI orchestrator` even though story subjects legitimately begin with vowels (an AI orchestrator, an engineer, an admin).

## Root Cause Analysis

The duplicate output is not an accidental double print call — it is two deliberate writes to two different streams that both land in the same terminal. In the `complete` command, the banner block is first written to stderr unconditionally (the inline comment says "Always print colored banner to stderr (visible even in --json mode)"), and then the identical banner plus `Next:` line is printed again to stdout via `console.log` inside the `else` (non-json) branch. When stdout and stderr are the same TTY, the user sees the block twice back-to-back. The stderr copy only earns its keep in `--json` mode, where stdout is reserved for the JSON payload; in plain mode it is pure duplication.

The `**As an**` rejection is an exact-prefix match in the stories parser. `FIELD_PREFIXES` maps the literal string `'**As a**'` to the `asA` field, and field binding uses `line.startsWith(prefix)`. A line beginning `**As an**` has `n` where the prefix expects the closing `*`, so it never matches, `asA` stays unset, and `flushStory` throws `Story US-N is missing required field: asA`. The grammatical variant was simply never encoded as an accepted label (added in 44e743646, unchanged by the compact-format fix 2ae96d47f).

### Evidence

- `src/cli/commands/complete.ts:527` — banner is written to stderr unconditionally before the json/non-json branch, per the inline comment "Always print colored banner to stderr (visible even in --json mode)".
- `src/cli/commands/complete.ts:543` — the same `agentBanner(...)` block and `Next:` line are printed again via `console.log` in the non-json branch, producing the second copy when both streams interleave on one terminal.
- `src/specs/stories-parser.ts:48` — `FIELD_PREFIXES` contains only `{ prefix: '**As a**', key: 'asA' }` and matching is `line.startsWith(prefix)` (line 231), so `**As an**` can never bind the `asA` field.

## Candidate Solutions

1. **Gate the stderr banner on json mode** — In `complete.ts`, only emit the stderr banner writes (lines 527-531, and the all-complete variant at 551-552) when `json` is true, which is the stated reason the stderr copy exists; the non-json branch keeps its stdout `console.log` output as the single human-facing copy. Tradeoff: any consumer that currently scrapes stderr for the banner in non-json mode (scripts or skill templates grepping output) would lose it and must read stdout instead.

2. **Drop the stdout duplicate instead** — Keep stderr as the canonical banner channel for both modes and delete the duplicated `console.log(agentBanner(...))` / `Next:` lines from the non-json branch, retaining only the `Run: metta instructions ...` hint on stdout. Tradeoff: stdout no longer carries the completion banner, which can silently break existing tests or pipelines asserting on stdout content, and stderr may be redirected away in some CI setups.

3. **Accept both article variants in the stories parser** — Replace the exact `'**As a**'` prefix entry with a small regex match (`/^\*\*As an?\*\*/`) for the `asA` field, or add a second `FIELD_PREFIXES` entry `'**As an**'`; update the stories template to mention both forms and add parser tests covering `**As an** AI orchestrator`. Tradeoff: the field-matching loop becomes slightly asymmetric (one regex among literal prefixes) or grows a near-duplicate entry, and any downstream tooling that re-serializes stories must treat the two labels as equivalent.
