# Verification: create-cli-slash-cmd-metta-fix

## What Was Built
- `metta fix-gap <slug>` CLI command with severity parsing and --all flag
- `metta fix-gap --remove-gap <slug>` for post-pipeline cleanup
- `/metta:fix-gap` skill with full pipeline orchestration
- `/fix-gap` slash command wrapper
- Registered in CLI index

## Gates
- TypeScript: clean (npx tsc --noEmit)
- Build: passes (npm run dev)
- CLI: `metta fix-gap --help` works, `metta fix-gap --all --json` returns sorted gaps

## Spec Compliance
- [x] Severity parsing from gap content (P1/High/Critical/Bug → critical)
- [x] --all sorts critical → medium → low
- [x] --remove-gap deletes gap file
- [x] Skill orchestrates full pipeline with parallel review/verify
- [x] Slash command delegates to skill
