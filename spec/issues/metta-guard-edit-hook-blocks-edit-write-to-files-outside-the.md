# metta-guard-edit hook blocks Edit/Write to files outside the project repo — path scoping too broad

**Captured**: 2026-07-14
**Status**: logged
**Severity**: minor

## Symptom
With no active metta change, the `metta-guard-edit` PreToolUse hook blocks Edit/Write to files that are entirely outside the project repository. Observed 2026-07-14: an Edit to `/home/utx0/.claude/projects/-home-utx0-Code-metta/memory/project_v02_subtractive_milestone.md` (Claude Code's per-project memory directory under the user's home, not under `/home/utx0/Code/metta`) was rejected with "metta-guard: Edit blocked — no active metta change. Start one with /metta:quick". Reproduced again while logging this very issue: the hook blocked a Write to the session scratchpad under `/tmp/claude-1000/...`. A file outside the working tree can never be part of a metta change, so the block adds friction without protection — the workaround (writing via a Bash one-liner) bypasses the hook trivially.

## Root Cause Analysis
The hook's path scoping is one-directional. After the no-active-change determination, it computes `relPath = relative(projectRoot, resolve(projectRoot, filePath))` and checks that value only against an exact-match allow-list (`spec/project.md`, `.metta/config.yaml`) and a directory-prefix allow-list (`spec/issues/`, `spec/backlog/`). For an absolute path outside the repo, `relative()` returns a `../..`-prefixed path that matches neither list, so control falls through to the unconditional block at the bottom of the file (`process.exit(2)`). There is no check for `relPath.startsWith('..')` or `isAbsolute(relPath)` that would recognize "this target is not under the project root at all" and exit 0. The hook therefore gates every filesystem write made from the session, not just repo source files, which contradicts its stated purpose (the header comment and nudge message scope it to work that belongs in a metta change). The same gap exists in the shipped template, so any fix must land in both the installed hook and the template source that `metta install` copies.

### Evidence
- `.claude/hooks/metta-guard-edit.mjs:69` — `relPath` is computed via `relative(projectRoot, ...)` but never tested for a `..` prefix, so out-of-repo absolute paths proceed to the allow-list checks as unmatched strings.
- `.claude/hooks/metta-guard-edit.mjs:78` — the block (`exit(2)`) is reached for any path that misses both allow-lists, including paths that resolve outside the working tree.
- `src/templates/hooks/metta-guard-edit.mjs:69` — the template copied at build/install time contains the identical logic, so the defect propagates to every project that installs metta hooks.

## Candidate Solutions
1. **Outside-root early allow** — After computing `relPath`, exit 0 when `relPath.startsWith('..') || isAbsolute(relPath)`, so anything not under the project root is never gated; apply to both the installed hook and `src/templates/hooks/metta-guard-edit.mjs`. Tradeoff: the check trusts `process.cwd()` as the project root — if the hook ever runs with a cwd deeper than the repo root, in-repo files could appear "outside" and silently bypass the guard; resolving the root via `git rev-parse --show-toplevel` would harden this at the cost of a subprocess call.
2. **Outside-root allow plus gitignored/.metta scratch exemption** — In addition to option 1, allow in-repo paths that are gitignored (via `git check-ignore -q <path>`) or under `.metta/`, since those cannot be repo source under change control. Tradeoff: adds a git subprocess to every guarded Edit/Write, increasing per-edit latency and introducing a failure mode when git is unavailable.
3. **Guard only tracked files** — Invert the scoping: block only when the target is tracked by git (`git ls-files --error-unmatch <path>` succeeds), allowing everything else. Tradeoff: newly created source files are untracked until first `git add`, so the guard's core protection (stopping new repo source work outside a metta change) would be substantially weakened.

