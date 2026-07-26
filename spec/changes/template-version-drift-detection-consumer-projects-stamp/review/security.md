VERDICT: PASS_WITH_WARNINGS

# Security Review: template-version-drift-detection-consumer-projects-stamp

Scope: OWASP-style review of the drift-detection diff (`git diff main...HEAD -- src/ tests/`), focused on untrusted YAML flowing into terminal/JSON output, YAML parsing safety, path handling, secrets, git injection, and DoS via crafted config.

## Threat model

`.metta/config.yaml` is repo-controlled content. A developer who clones an untrusted repository and runs any `metta` command executes the drift check against that repo's config. `installed_version` is therefore attacker-controllable input; the running version (from the tool's own `package.json`) is trusted.

## Findings

### Major (should fix)

1. **Unsanitized, unbounded `installed_version` interpolated into raw stderr — terminal escape / line-forgery injection.**
   - File: `src/cli/index.ts`, preAction hook (drift phase, ~line 133-141)
   - `readInstalledVersion` (`src/config/version-drift.ts:31-41`) returns any YAML string verbatim — no character-class check, no length cap. That string is interpolated directly into `process.stderr.write(`Warning: metta assets were installed by v${drift.installed} ...`)`. A malicious config can embed:
     - ANSI/OSC escape sequences (cursor movement, screen clear, OSC 0 title set, OSC 8 fake hyperlinks, OSC 52 clipboard write on terminals that allow it), or
     - newlines to forge additional fake output lines on every metta invocation, or
     - a multi-megabyte string that floods stderr on every command.
   - Fix: in `readInstalledVersion`, reject (return `undefined` for) values that fail a conservative pattern such as `/^[0-9A-Za-z.+-]{1,64}$/`, or at minimum strip control characters (`/[\x00-\x1f\x7f]/`) and cap length before the value ever reaches output. One bound at the read site covers all three sinks below.

2. **Same unsanitized value flows into `metta doctor` human-readable output.**
   - File: `src/cli/commands/doctor.ts` (Template freshness check, ~line 101-107) via `templateFreshnessCheck` (`src/config/version-drift.ts:59-77`), printed raw by the existing `console.log(`  ${icon} ${c.check}${detail}`)` loop.
   - Same escape-sequence/newline injection as finding 1. Fixed automatically if sanitization lives in `readInstalledVersion`.

### Minor

3. **Unbounded attacker string embedded in machine-readable JSON.**
   - Files: `src/cli/helpers.ts` `outputJson` (drift merge, lines ~148-160); `src/cli/commands/doctor.ts` JSON checks output.
   - `JSON.stringify` correctly escapes control characters (ESC is < 0x20), so raw escape injection into stdout JSON is not possible — this sink is safe against finding 1's vector. However, an arbitrarily large `installed` string still passes through unbounded into the payload consumed by downstream tooling. The length cap from finding 1 resolves this too.

4. **Second full read + parse of config.yaml on every CLI invocation.**
   - File: `src/config/version-drift.ts:32-34` — `readFile` + `YAML.parse` of the whole config in the preAction hook, in addition to the existing ConfigLoader parse.
   - `yaml@2.8.3` with default options is used: no custom tags, no code execution, and alias amplification ("billion laughs") is bounded by the library's default `maxAliasCount: 100`. A pathologically large config file is loaded fully into memory, but that exposure pre-exists via ConfigLoader; the marginal cost here is negligible. No action required; noted for completeness.

5. **Empty-string stamp produces a malformed warning.**
   - File: `src/config/version-drift.ts:16-23` — `detectVersionDrift('', running)` yields drift (test-asserted), so the warning reads `installed by v  but you are running ...`. Cosmetic; the regex from finding 1 (min length 1) would turn empty string into "no stamp" instead, which is arguably the more correct semantic.

## Checked and clean

- **YAML parsing safety** — `YAML.parse`/`parseDocument` from `yaml@2` (^2.7.1, resolved 2.8.3), default core schema, no custom tags, no eval-style behavior; parse errors are caught and mapped to `undefined` (`version-drift.ts:38-40`). Drift phase in `index.ts` is additionally wrapped in try/catch so a crafted config cannot break or error a CLI invocation.
- **Path handling** — `join(root, '.metta', 'config.yaml')` with `root` from `process.cwd()`/`ctx.projectRoot`; no user-controlled path segments, no traversal surface.
- **Write path / YAML injection** — `stampInstalledVersion` writes only the trusted version string from the tool's own `package.json` (`getPackageVersion`, `helpers.ts:401-406`) via `setProjectField`, which uses the yaml document API (`doc.setIn` + `doc.toString()`), so values are properly quoted — no YAML structure injection into config.
- **Git command injection** — no new git invocations; existing `autoCommitFile` uses `execFile` with argument arrays (no shell), and no drift-derived strings reach git arguments.
- **Secrets** — only version strings are read/logged; no credentials, tokens, or env values touch the new code paths. The drift reader deliberately skips `~/.metta/config.yaml` and env overlays, shrinking the data it can ever surface.
- **JSON contract safety** — `outputJson` only augments plain objects, never arrays, and never displaces an existing `template_version_mismatch` key (test-covered in `tests/cli-helpers.test.ts`); stdout remains a single well-formed JSON document with the warning confined to stderr (test-covered in `tests/cli-version-drift.test.ts`).

## Verdict rationale

No critical (must-fix-before-ship) issues: the injection sinks require the victim to run metta inside a repo with a hostile `.metta/config.yaml`, impact is terminal-output deception/annoyance rather than code execution, and the JSON contract is escape-safe. The two major findings share a single one-line-class fix — validate/bound `installed_version` at the read boundary in `readInstalledVersion` — and should be addressed before release.

## Round 2

VERDICT: PASS

Re-review of commit `662c1c48c` against round 1 majors 1 and 2 (unbounded/unsanitized `installed_version` reaching stderr and doctor output).

### Fix verification

1. **Validation at the read boundary — confirmed.** `src/config/version-drift.ts:32` defines `const VALID_STAMP = /^[0-9A-Za-z.+-]{1,64}$/` and `readInstalledVersion` (`version-drift.ts:48`) returns the stamp only when `typeof value === 'string' && VALID_STAMP.test(value)`, else `undefined` (treated as "no stamp").
   - **Anchored:** `^...$` with no `m` flag — in JavaScript `$` without multiline matches only at absolute end of input (it does not tolerate a trailing newline, unlike Python), so partial-match bypass is impossible.
   - **Charset:** `[0-9A-Za-z.+-]` — excludes ESC (0x1b), BEL (0x07), CR/LF, all C0/C1 controls, whitespace, quotes, and shell metacharacters. `-` is positioned last in the class (literal), `.` and `+` are literal inside a class. ANSI/OSC escape sequences, line forgery, and title/clipboard OSC vectors are all structurally excluded.
   - **Length:** `{1,64}` — rejects empty string (also resolving round 1 minor 5, the malformed `v ` warning) and multi-megabyte flood payloads (round 1 findings 1c and 3).

2. **All sinks receive only validated values — confirmed.** Traced every consumer:
   - stderr warning: `src/cli/index.ts:137-144` — `drift.installed` originates exclusively from `readInstalledVersion(process.cwd())` via `detectVersionDrift`. Validated.
   - doctor: `src/cli/commands/doctor.ts:105` — `templateFreshnessCheck(await readInstalledVersion(ctx.projectRoot), ...)`. Validated.
   - JSON merge: `src/cli/helpers.ts:148-160` — `getVersionDrift()` reads the module slot written only by `recordVersionDrift` at `index.ts:141`, which is fed only the validated value. Validated (and JSON.stringify-escaped regardless).
   - No other call sites of `readInstalledVersion`/`detectVersionDrift`/`recordVersionDrift`/`getVersionDrift`/`templateFreshnessCheck` exist outside tests.

3. **Bypass search — no unvalidated read path found.** `grep -rn installed_version src/` (excluding tests) shows only `version-drift.ts` and the Zod schema field `src/schemas/project-config.ts:117`. No ConfigLoader-based code path reads or prints `config.installed_version`; the drift feature never goes through ConfigLoader (ADR-1). The generic `metta config get installed_version` echo (`src/cli/commands/config.ts:58`) can print the raw value, but that is the pre-existing key-echo mechanism for every config key, is user-initiated (the user explicitly asks for that key), and is not part of this change's automatic output flow — out of scope, noted below as defense-in-depth.

4. **Adversarial tests pass — confirmed.** `npx vitest run src/config/version-drift.test.ts`: 27/27 passed. Includes the new cases: ANSI escape sequence in stamp (`version-drift.test.ts:112`), >64-character stamp (`:117`), and embedded newline (`:123`) — all asserted to return `undefined`.

### Residual (non-blocking)

- Suggestion — `src/schemas/project-config.ts:117`: `installed_version: z.string().optional()` is unbounded at the schema layer. Tightening to `.max(64)` (or the same regex) would give defense in depth for any future consumer that reads the field via ConfigLoader instead of `readInstalledVersion`. Not required for this change: no such consumer exists today.

### Round 2 rationale

Both round 1 majors are closed by a single, correctly placed control at the only read boundary for the stamp; the regex is anchored, charset-safe, and length-bounded; every sink is downstream of that boundary; adversarial tests cover the exact vectors reported. Round 1 minors 3 and 5 are resolved as side effects. No new findings.
