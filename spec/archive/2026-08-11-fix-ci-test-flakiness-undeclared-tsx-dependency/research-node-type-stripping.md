# Research: Run the TS CLI via Node native type stripping

## Approach

Replace `npx tsx src/cli/index.ts` in `tests/helpers/cli.ts` with a direct
`node` invocation of the TypeScript entry point, relying on Node 22+'s built-in
TypeScript type stripping (`--experimental-strip-types`, default-on since Node
22.18.0 / 23.6.0). Zero new dependencies, zero network activity at test time.

A sub-variant is also assessed: keep `npx tsx` and raise or env-gate the 10s
timeout.

## How it works

Node's type stripping (powered by the internal Amaro/SWC stripper) erases
inline type annotations from `.ts` files and executes the result directly —
no install, no registry fetch. On the project's runtimes:

- Local: Node v22.22.0 — type stripping is enabled by default (default-on
  landed in 22.18.0 for the 22.x line).
- CI: `.github/workflows/ci.yml` pins `node-version: 22` (lines 23, 45), which
  resolves to a current 22.x ≥ 22.18, so default-on there too.
- Declared support floor: `package.json` `engines.node: ">=22.0.0"` — versions
  22.0–22.5 have **no** type stripping at all, and 22.6–22.17 need the
  `--experimental-strip-types` flag.

Source: https://nodejs.org/api/typescript.html

## Required changes (file-by-file)

- `tests/helpers/cli.ts` — change the exec line to
  `node --experimental-strip-types src/cli/index.ts` (flag kept for the
  declared >=22.0.0 floor; errors as unknown option below 22.6).

No other changes would be needed — **if the codebase were compatible. It is
not** (see blockers).

## Pros

- Zero new dependencies; nothing resolved over the network at test time.
- Aligns perfectly with the constitution's "tsx is not currently part of the
  dev loop".
- No build step needed before tests; no stale-`dist/` risk.

## Cons / Risks

Two hard blockers, verified against this codebase:

1. **Import specifier mismatch (fatal).** The project follows the Node16 ESM
   convention of `.js` extensions in TS import paths (e.g. `src/index.ts` has
   40 such relative imports; they exist in essentially every src file). Node's
   type-stripping loader does **not** remap `.js` specifiers to `.ts` files —
   per the Node docs, imports of TypeScript files must use the actual `.ts`
   extension (or enable `--experimental-transform-types` + rewrite specifiers;
   rewriting is never automatic). Running `node src/cli/index.ts` fails on the
   first relative import with `ERR_MODULE_NOT_FOUND`. Fixing this means
   rewriting every import specifier in `src/` to `.ts` — which then breaks the
   `tsc` build that emits `.js` files, unless `rewriteRelativeImportExtensions`
   plus a TS 5.7+ toolchain change is adopted. That is a project-wide
   migration, wildly out of scope for this fix.
2. **Non-erasable syntax (fatal in strip mode).** The codebase uses
   constructor parameter properties extensively (verified in at least 9 files:
   `backlog-store.ts`, `roadmap-store.ts`, `config-loader.ts`, `gaps-store.ts`,
   `issues-store.ts`, `spec-lock-manager.ts`, `merge-safety.ts`, `semver.ts`,
   `workflow-engine.ts`). Parameter properties are TypeScript-only syntax that
   strip mode rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); they require
   `--experimental-transform-types`, which is still experimental and does not
   solve blocker 1.
3. Version-floor mismatch: `engines.node >=22.0.0` admits Node versions with
   no stripping support at all, so the helper would be broken on a declared-
   supported runtime.

### Sub-variant: raise the 10s runCli timeout

Bumping `timeout: 10000` (or env-gating it higher in CI) gives cold-cache
`npx` fetches more headroom but leaves the root cause intact: tsx remains
undeclared, `npx` may still hit the registry per invocation, and a failed or
throttled fetch still kills the run — now after a longer wait, making genuine
hangs slower to surface. It converts frequent flakes into rarer, slower
flakes. Not a fix; at most a complementary hardening.

## Verdict

**2/10** — attractive in principle (zero deps, zero network) but disqualified
by two verified hard blockers: `.js`-extension imports that Node will not
remap to `.ts`, and pervasive constructor parameter properties that strip
mode rejects; fixing either is a project-wide migration far beyond this
change's scope.
