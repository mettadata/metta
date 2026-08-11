# Research: fix-ci-test-flakiness-undeclared-tsx-dependency

## Decision: Declare tsx as a devDependency

### Approaches Considered

1. **Declare tsx as a devDependency** (selected) — see
   [research-declare-tsx.md](research-declare-tsx.md). Verdict 9/10. Add
   `"tsx": "^4.23.12"` to `devDependencies`; `npm ci` then installs it and
   `npx` resolves the local project binary before ever touching the registry,
   eliminating the network fetch inside the 10s exec timeout for all ~20 test
   files that invoke `npx tsx`. Two-file code diff (package.json + lockfile).
   The lockfile already contains `esbuild@0.28.1` and all `@esbuild/*`
   platform binaries, satisfying tsx's `esbuild ~0.28.0` dependency with no
   conflicts. Requires reconciling the constitution line "tsx is not currently
   part of the dev loop" (`spec/project.md`, mirrored in `CLAUDE.md`) — that
   line is already de facto false since the test suite execs tsx today.

2. **Run CLI tests against built `dist/`** — see
   [research-dist-cli.md](research-dist-cli.md). Verdict 8/10. Also fully
   removes the root cause and speeds up spawns (~0.48s vs ~2.38s), and the
   "do NOT switch to dist" helper comment turned out to be a retired
   refactor-parity invariant, not an architectural constraint. Not selected
   because the real change surface is 19 files (18 test files duplicate the
   `npx tsx` harness beside the shared helper), plus CI reordering and a
   `pretest` build hook with a residual stale-dist window for direct
   `npx vitest run` / watch-mode invocations. Materially larger blast radius
   for the same flake fix; a strong follow-up candidate as its own change.

3. **Run TS directly via Node native type stripping** — see
   [research-node-type-stripping.md](research-node-type-stripping.md).
   Verdict 2/10. Disqualified by two verified hard blockers: the codebase's
   `.js`-extension ESM imports are not remapped to `.ts` by Node's loader
   (`ERR_MODULE_NOT_FOUND` on the first relative import), and pervasive
   constructor parameter properties are non-erasable syntax rejected by strip
   mode. Fixing either is a project-wide migration. The sub-variant of merely
   raising the 10s timeout treats the symptom and leaves registry fetches in
   the test path.

### Rationale

Both viable approaches eliminate the root cause; declare-tsx does it with the
smallest possible diff (dependency declaration + lockfile + doc reconciliation)
and zero behavior change to the test harness, while dist-cli requires touching
19 files and introduces a new stale-build failure mode needing its own guard.
For an issue-fix change, the minimal, deterministic diff wins. The
constitution's stale "tsx is not currently part of the dev loop" line is
updated as part of this change (Deviation: doc line update is required for
consistency, per US-3). CI ordering (`npm test` before `npm run build`) becomes
harmless once tsx is installed by `npm ci`, so no workflow reordering is
needed. The dist-cli approach is recorded as a worthwhile future backlog item
for spawn-speed gains.

### Artifacts Produced

- [Approach: declare tsx](research-declare-tsx.md)
- [Approach: dist CLI](research-dist-cli.md)
- [Approach: node type stripping](research-node-type-stripping.md)
