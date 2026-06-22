# Implementation: bump-vitest-transitive-dependency-overrides-clear-6-open

## Goal

Clear metta's open Dependabot / `npm audit` security alerts by bumping the
`vitest` devDependency and pinning vulnerable transitive dependencies via a
top-level `overrides` block. No source or test code changed; no
`@anthropic-ai/sdk` upgrade.

## package.json diff

```diff
   "devDependencies": {
     "@types/node": "^22.15.3",
     "typescript": "^5.8.3",
-    "vitest": "^3.1.3"
+    "vitest": "^3.2.6"
+  },
+  "overrides": {
+    "form-data": ">=4.0.6",
+    "vite": ">=7.3.5",
+    "postcss": ">=8.5.10",
+    "esbuild": ">=0.28.1"
   }
 }
```

The `overrides` block was applied exactly as specified. `npm install`
succeeded on the first attempt with no `--force` and no `--legacy-peer-deps`;
no override needed to be relaxed. `package-lock.json` was regenerated
(7 packages added, 3 removed, 17 changed; 138 audited).

## npm audit: before → after

### Before (baseline)

```
# npm audit report

esbuild  0.27.3 - 0.28.0   (low)     GHSA-g7r4-m6w7-qqqr  arbitrary file read (dev server, Windows)   via vitest→vite
form-data  4.0.0 - 4.0.5   (high)    GHSA-hmw2-7cc7-3qxx  CRLF injection in multipart field names     via @anthropic-ai/sdk
postcss  <8.5.10           (moderate) GHSA-qx2v-qp2m-jg93 XSS via unescaped </style> in stringify     via vitest→vite
vite  7.0.0 - 7.3.3        (high)    GHSA-v6wh-96g9-6wx3 + GHSA-fx2h-pf6j-xcff  launch-editor NTLM / fs.deny bypass   via vitest
vitest  <3.2.6             (critical) GHSA-5xrq-8626-4rwp Vitest UI server arbitrary file read/exec    direct devDependency

5 vulnerabilities (1 low, 1 moderate, 2 high, 1 critical)
```

> Note: the change title references "6 open" Dependabot alerts; `npm audit`
> reports these as 5 deduplicated advisories (the two vite advisories collapse
> into a single vite finding). All of the underlying packages named in the
> goal — vitest, vite, postcss, esbuild, form-data — are covered and cleared.

### After

```
found 0 vulnerabilities
```

## Resolved versions (`npm ls vitest vite esbuild postcss form-data`)

```
@mettadata/metta@0.1.0
├─┬ @anthropic-ai/sdk@0.39.0
│ └─┬ @types/node-fetch@2.6.13
│   └── form-data@4.0.6 overridden
└─┬ vitest@3.2.6
  ├─┬ @vitest/mocker@3.2.6
  │ └── vite@8.0.16 deduped
  ├─┬ vite-node@3.2.4
  │ └── vite@8.0.16 deduped
  └─┬ vite@8.0.16 overridden
    ├── esbuild@0.28.1 overridden
    └── postcss@8.5.15 overridden
```

| Package    | Patched floor | Resolved | Meets floor |
|------------|---------------|----------|-------------|
| vitest     | >=3.2.6       | 3.2.6    | yes         |
| vite       | >=7.3.5       | 8.0.16   | yes         |
| esbuild    | >=0.28.1      | 0.28.1   | yes         |
| postcss    | >=8.5.10      | 8.5.15   | yes         |
| form-data  | >=4.0.6       | 4.0.6    | yes         |

The `>=7.3.5` floor on vite resolved to vite 8.0.16, which vitest 3.2.6 pulls
in and dedupes across `@vitest/mocker` and `vite-node`. All floors satisfied.

## Verification

| Step                | Command            | Result |
|---------------------|--------------------|--------|
| Build               | `npm run build`    | PASS (tsc + copy-templates, exit 0) |
| Typecheck           | `npx tsc --noEmit` | PASS (exit 0) |
| Full test suite     | `npx vitest run`   | PASS |

### Full-suite result

```
Test Files  76 passed (76)
     Tests  966 passed (966)
  Duration  189.41s
```

76 test files, 966 tests, 0 failures, ~3.16 min wall clock. The new vitest
3.2.6 runner executes the entire suite (including the split `cli*.test.ts`
files) with no regressions, confirming the bump is safe.

## Residual

None. `npm audit` reports 0 vulnerabilities. No overrides were relaxed; no
`--force` / `--legacy-peer-deps` was used.
