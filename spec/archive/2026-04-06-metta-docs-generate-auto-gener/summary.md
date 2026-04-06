# Summary: metta docs generate

## What Was Built
- DocGenerator class (src/docs/doc-generator.ts) — template-based doc generation
- 4 doc templates (architecture, api, changelog, getting-started)
- metta docs generate [type] [--dry-run] CLI command
- Auto-trigger on finalize when docs.generate_on is 'finalize'
- Doc headers with source paths

## Verification
- 292 tests passing, tsc clean
- metta docs generate --dry-run works
- metta docs generate produces 4 files in docs/
