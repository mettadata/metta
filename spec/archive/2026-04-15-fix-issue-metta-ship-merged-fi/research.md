# Research: fix-issue-metta-ship-merged-fi

Surgical bug fix; no exploration needed. Decisions locked in intent + spec.

## Confirmed
- `src/ship/merge-safety.ts:run()` currently starts with `preflight` step at line ~31. New `finalize-check` step inserts before it.
- `cwd` is the project root (passed in constructor). Use `node:fs.existsSync` + `node:fs/promises.readdir` to glob `spec/archive/`.
- Finalizer (`src/finalize/finalizer.ts`) writes archive entries as `<YYYY-MM-DD>-<change-name>/`. Pattern: `spec/archive/*-${changeName}/`.
- No existing tests exercise pre-archive ship; all current `merge-safety.test.ts` fixtures use `feature`-style branch names that won't have `metta/` prefix → new check will skip on them. No fixture updates needed for existing tests.
