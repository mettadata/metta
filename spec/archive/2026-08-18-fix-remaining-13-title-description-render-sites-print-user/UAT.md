# UAT: fix-remaining-13-title-description-render-sites-print-user

- **Change**: fix-remaining-13-title-description-render-sites-print-user
- **Generated**: 2026-08-18
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Add a newline-preserving sanitizer variant to `src/util/sanitize-text.ts`: `stripControlSequencesMultiline(text)` (exact name settled at design time), which preserves `\n` line breaks but strips every other control sequence and control byte per the existing `CONTROL_SEQUENCE_RE` coverage (CSI, OSC, DCS/SOS/PM/APC, two-byte Fe escapes, bare C0/C1/DEL — including `\r`, so CRLF input normalizes to LF). It reuses the existing regex/logic rather than duplicating it, stays pure and idempotent, and passes printable text (all Unicode at or above U+00A0) through unchanged.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Wrap each unsanitized render site at the render edge — inside the `console.log` template expression, exactly as the two PR #86 sites do:
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: JSON output paths stay byte-faithful. Only the human-readable (`console.log` to TTY) branches change; every `outputJson(...)` branch continues to emit the stored strings unmodified so machine consumers see exact file content.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Tests in `tests/sanitize-text.test.ts` for the new variant (newline preservation, CR stripping, escape-sequence coverage parity with the single-line helper, idempotence, Unicode pass-through), plus command-level render tests asserting that titles/descriptions containing escape sequences are printed stripped in text mode and unmodified in `--json` mode for at least one list site, one heading site, and one multi-line body site.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Wrapped every remaining human-rendered title/description print site behind control-sequence sanitization at the render edge, and added a newline-preserving helper variant for multi-line bodies. JSON output paths (`outputJson`) remain byte-faithful and untouched.

#### Step 2.1
- **Do**: Confirm: `src/util/sanitize-text.ts` — added `stripControlSequencesMultiline(text)`: splits on `\n`, sanitizes each line via the existing `stripControlSequences`, rejoins with `\n`. Preserves LF, normalizes CRLF to LF, bounds unterminated OSC/DCS bodies to their line. Existing helper and regex untouched.
- **Observe**: behaves as described
- [ ] Pass
