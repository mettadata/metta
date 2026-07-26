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
