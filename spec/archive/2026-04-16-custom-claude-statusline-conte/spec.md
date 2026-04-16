# custom-claude-statusline-conte

## ADDED: Requirement: Statusline script stdin contract

The statusline script MUST read all bytes from stdin and attempt to parse them as a single JSON object. The script MUST tolerate missing stdin (empty input) by treating the payload as an empty object `{}`. The script MUST tolerate malformed or truncated stdin by treating the payload as an empty object `{}` rather than crashing. The script MUST extract `transcript_path` (string) and `model` (string) fields from the parsed object when present. The script MUST treat absent or non-string values for either field as if the field were not supplied.

### Scenario: Valid stdin with both fields present

- GIVEN stdin contains `{"transcript_path":"/home/user/.claude/sessions/abc.jsonl","model":"claude-sonnet-4-6"}`
- WHEN the statusline script reads stdin
- THEN `transcript_path` resolves to `/home/user/.claude/sessions/abc.jsonl` and `model` resolves to `claude-sonnet-4-6`

### Scenario: Empty stdin treated as empty payload

- GIVEN stdin is closed immediately with no bytes written
- WHEN the statusline script reads stdin
- THEN execution continues with both `transcript_path` and `model` treated as absent (no crash, no unhandled exception)

### Scenario: Malformed JSON on stdin treated as empty payload

- GIVEN stdin contains the string `{not valid json`
- WHEN the statusline script reads stdin
- THEN execution continues with both fields treated as absent and the script does not throw an unhandled exception

### Scenario: Stdin contains valid JSON but fields are wrong type

- GIVEN stdin contains `{"transcript_path":42,"model":true}`
- WHEN the statusline script reads stdin
- THEN both `transcript_path` and `model` are treated as absent (non-string values ignored)

---

## ADDED: Requirement: Context window resolution

The script MUST resolve a context window size in tokens from the `model` field of the stdin payload. The script MUST return `1000000` when the model string contains the substring `[1m]` (case-sensitive). The script MUST return `200000` for any other non-empty model string that does not contain `[1m]`. The script MUST return `200000` when the `model` field is absent or not a string.

### Scenario: Model id contains [1m] substring

- GIVEN the parsed stdin payload contains `"model":"claude-opus-4-6[1m]"`
- WHEN context window size is resolved
- THEN the resolved window size is `1000000`

### Scenario: Model id present but does not contain [1m]

- GIVEN the parsed stdin payload contains `"model":"claude-sonnet-4-6"`
- WHEN context window size is resolved
- THEN the resolved window size is `200000`

### Scenario: Model field absent

- GIVEN the parsed stdin payload is `{}` (no model field)
- WHEN context window size is resolved
- THEN the resolved window size is `200000`

### Scenario: Model field contains [1m] as part of a longer string

- GIVEN the parsed stdin payload contains `"model":"claude-opus-4-6[1m]-custom"`
- WHEN context window size is resolved
- THEN the resolved window size is `1000000` (substring match is sufficient)

---

## ADDED: Requirement: Context utilization calculation

The script MUST read the JSONL file at `transcript_path` when that field is present and is a string. The script MUST parse each newline-delimited line as a JSON object and identify the most recent line where `message.role` is `"assistant"` and `message.usage.input_tokens` is a number. The script MUST compute the utilization percentage as `Math.round(input_tokens / window_size * 100)`. The script MUST omit the percentage from the output (not append `<ctx>%`) when the JSONL file cannot be read, when it contains no lines matching the criteria, or when `transcript_path` is absent. The script MUST NOT throw an unhandled exception if the file does not exist or if individual JSONL lines are malformed; malformed lines MUST be skipped silently.

### Scenario: Transcript present with assistant usage entry

- GIVEN `transcript_path` points to a JSONL file whose last assistant message has `message.usage.input_tokens` equal to `100000` and the resolved window size is `200000`
- WHEN the script calculates context utilization
- THEN the computed percentage is `50` and the output line ends with `] 50%`

### Scenario: Transcript present but no assistant usage entry found

- GIVEN `transcript_path` points to a JSONL file that contains only user-role message lines and no assistant lines with a `message.usage.input_tokens` field
- WHEN the script calculates context utilization
- THEN the percentage is omitted and the output does not contain a `%` character

### Scenario: Transcript file does not exist

- GIVEN `transcript_path` points to a path that does not exist on the filesystem
- WHEN the script attempts to read the JSONL file
- THEN the script does not crash; the percentage is omitted from the output line

### Scenario: Most recent assistant usage entry is used

- GIVEN a JSONL file where the second-to-last assistant message has `input_tokens` 50000 and the last assistant message has `input_tokens` 80000, and window size is `200000`
- WHEN the script computes utilization
- THEN the computed percentage is `40` (based on `80000 / 200000`)

---

## ADDED: Requirement: Metta artifact resolution

The script MUST execute `metta status --json` as a subprocess with a timeout of `5000` milliseconds. The script MUST parse the stdout of that subprocess as JSON and extract the `current_artifact` string field. The script MUST use the literal string `idle` as the artifact label when: stdout is empty, the subprocess exits with a non-zero code within the timeout, the subprocess stdout cannot be parsed as JSON, or the parsed JSON does not contain a non-empty `current_artifact` string. The script MUST use `idle` when no active change exists (i.e. `metta status --json` succeeds but returns no active change). The script MUST NOT use `unknown` for artifact resolution failures alone; `unknown` is reserved for unrecoverable errors that prevent producing any output (see Output Format requirement).

### Scenario: metta status returns active artifact

- GIVEN `metta status --json` exits 0 and its stdout is `{"current_artifact":"implementation","change":"some-slug"}`
- WHEN the script resolves the artifact label
- THEN the resolved artifact is `implementation`

### Scenario: metta status returns no active change

- GIVEN `metta status --json` exits 0 and its stdout is `{"changes":[],"message":"No active change"}`
- WHEN the script resolves the artifact label
- THEN the resolved artifact is `idle`

### Scenario: metta binary not found on PATH

- GIVEN the `metta` executable is not on PATH and the subprocess spawn fails with ENOENT
- WHEN the script resolves the artifact label
- THEN the resolved artifact is `idle` (not `unknown`) and the script does not crash

### Scenario: metta status --json times out

- GIVEN `metta status --json` does not exit within 5000 milliseconds
- WHEN the subprocess is killed by the timeout
- THEN the resolved artifact is `idle` and the script continues to produce output

---

## ADDED: Requirement: Output format

The script MUST print exactly one line to stdout, terminated with a single newline character. When context utilization percentage is available the line MUST match the pattern `[metta: <artifact>] <pct>%` where `<artifact>` is the resolved artifact label (possibly ANSI-wrapped per the coloring requirement) and `<pct>` is the rounded integer. When context utilization is not available the line MUST match the pattern `[metta: <artifact>]` with no trailing space or percent. When any unrecoverable error prevents producing the above output the line MUST be exactly `[metta: unknown]` with no ANSI codes and no trailing content. The exit code MUST always be `0` regardless of any error condition.

### Scenario: Full output with artifact and context percentage

- GIVEN the resolved artifact is `spec` and the computed context percentage is `43`
- WHEN the script prints its output
- THEN stdout is the single line `[metta: spec] 43%` (ignoring ANSI color wrapping around `spec`)

### Scenario: Output with idle artifact and no context percentage

- GIVEN the resolved artifact is `idle` and `transcript_path` is absent
- WHEN the script prints its output
- THEN stdout is exactly `[metta: idle]` followed by a newline and exit code is `0`

### Scenario: Unrecoverable error fallback

- GIVEN an unrecoverable error occurs (e.g. the top-level async function rejects unexpectedly)
- WHEN the script catches the error
- THEN stdout is exactly `[metta: unknown]` followed by a newline and exit code is `0`

### Scenario: Exit code is always 0

- GIVEN stdin is `{not json}` and `metta` is not on PATH
- WHEN the script runs to completion
- THEN the process exits with code `0`

---

## ADDED: Requirement: Deterministic change-slug coloring

When the resolved artifact is not `idle` and not `unknown`, AND a non-empty change slug is available from `metta status --json`, the script MUST wrap the artifact label text with ANSI SGR escape sequences to apply a foreground color. The color MUST be selected deterministically by hashing the change slug to an index into a fixed palette of ANSI color codes drawn from the set `{31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96}` (or a subset of at least 6 of those codes). The same slug MUST produce the same color code on every invocation. When the artifact is `idle` or `unknown`, or when no change slug is available, the output MUST contain no ANSI escape sequences.

### Scenario: Active change slug produces ANSI-wrapped label

- GIVEN `metta status --json` returns `{"current_artifact":"tasks","change":"custom-claude-statusline-conte"}`
- WHEN the script renders the artifact label
- THEN stdout contains an ANSI escape sequence of the form `\x1b[<n>m` where `<n>` is an integer from the defined palette, followed by the text `tasks`, followed by `\x1b[0m` (reset)

### Scenario: Same slug produces same color on repeated runs

- GIVEN the change slug is `my-feature-slug` on two separate invocations
- WHEN the script renders the artifact label each time
- THEN both invocations produce the identical ANSI escape sequence wrapping the label

### Scenario: Idle artifact is not colored

- GIVEN the resolved artifact is `idle`
- WHEN the script renders the output
- THEN the output string `[metta: idle]` contains no ANSI escape sequences (`\x1b` does not appear)

### Scenario: Unknown fallback is not colored

- GIVEN an unrecoverable error forces the output to `[metta: unknown]`
- WHEN the script prints that line
- THEN the string contains no ANSI escape sequences

---

## ADDED: Requirement: Install auto-registration

`metta install` MUST copy `dist/templates/statusline/statusline.mjs` to `.claude/statusline/statusline.mjs` relative to the project root, creating the `.claude/statusline/` directory if it does not exist. The script MUST be written with file mode `0o755`. `metta install` MUST idempotently merge a `statusLine` key into `.claude/settings.json` whose value is the absolute path to the installed script (`.claude/statusline/statusline.mjs` resolved against the project root). When `.claude/settings.json` already contains a `statusLine` key whose value is that same absolute path, `metta install` MUST leave the file unchanged (no duplicate write, no JSON reformatting that alters other keys). When `.claude/settings.json` already contains a `statusLine` key pointing at a different path (user-authored customization), `metta install` MUST NOT overwrite it and MUST emit a warning message to stderr noting the existing value was preserved.

### Scenario: Fresh install writes script and updates settings

- GIVEN `.claude/statusline/statusline.mjs` does not exist and `.claude/settings.json` either does not exist or does not contain a `statusLine` key
- WHEN `metta install` runs
- THEN `.claude/statusline/statusline.mjs` exists with file mode `0o755` and `.claude/settings.json` contains `"statusLine":"<absolute-path>/.claude/statusline/statusline.mjs"`

### Scenario: Re-run install is a no-op

- GIVEN `metta install` has already been run and `.claude/settings.json` already contains `"statusLine":"<absolute-path>/.claude/statusline/statusline.mjs"`
- WHEN `metta install` runs a second time
- THEN `.claude/settings.json` is not rewritten and still contains exactly one `statusLine` key with the same value

### Scenario: Existing unrelated keys in settings.json are preserved

- GIVEN `.claude/settings.json` exists with content `{"mcpServers":{"foo":{}}}` and no `statusLine` key
- WHEN `metta install` runs
- THEN `.claude/settings.json` retains the `mcpServers` key and also gains the `statusLine` key

### Scenario: User-authored statusLine pointing at a different path is not overwritten

- GIVEN `.claude/settings.json` contains `"statusLine":"/usr/local/bin/my-custom-statusline.sh"`
- WHEN `metta install` runs
- THEN `.claude/settings.json` still contains `"statusLine":"/usr/local/bin/my-custom-statusline.sh"` unchanged and a warning is emitted to stderr containing the text `statusLine` and the existing path

---

## ADDED: Requirement: Install failure isolation

If any step of the statusline install sub-procedure fails — including write errors for the script file, directory creation failures, or a `.claude/settings.json` that cannot be parsed as JSON — `metta install` MUST emit a warning message to stderr and MUST continue executing the remaining install steps. `metta install` MUST NOT set a non-zero exit code solely because the statusline install step failed. The overall install MUST complete and report success for all other steps that succeeded.

### Scenario: Script copy fails due to permissions error

- GIVEN the `.claude/` directory exists but is not writable (e.g. mode 0o555)
- WHEN `metta install` attempts to copy the statusline script
- THEN a warning line is printed to stderr containing the text `statusline` and `metta install` exits with code `0` after completing all other install steps

### Scenario: settings.json is unparseable JSON

- GIVEN `.claude/settings.json` exists but contains `{broken json`
- WHEN `metta install` runs the statusline registration step
- THEN `metta install` emits a warning to stderr, does not overwrite `.claude/settings.json`, and continues to complete other install steps without aborting

### Scenario: Failure does not suppress guard hook installation

- GIVEN the statusline copy step throws an error
- WHEN `metta install` handles that error
- THEN the `metta-guard-edit.mjs` hook registration step still executes and its result is reported in the install output

### Scenario: Warning message identifies the failed component

- GIVEN the statusline install step fails with any error
- WHEN the warning is emitted to stderr
- THEN the warning message contains the substring `statusline` so the user knows which component failed

---

## ADDED: Requirement: Template build copy

The build pipeline MUST copy all files matching `src/templates/statusline/*.mjs` to `dist/templates/statusline/` preserving the executable bit (`0o755`) on each copied file. The copy MUST occur as part of the standard build invoked by `npm run build`. The destination directory `dist/templates/statusline/` MUST be created if it does not exist. When no `.mjs` files exist under `src/templates/statusline/`, the build MUST succeed without error (the directory may or may not be created).

### Scenario: Build copies statusline.mjs to dist

- GIVEN `src/templates/statusline/statusline.mjs` exists
- WHEN `npm run build` completes successfully
- THEN `dist/templates/statusline/statusline.mjs` exists and has file mode `0o755`

### Scenario: Copied file is executable

- GIVEN `src/templates/statusline/statusline.mjs` has a `#!/usr/bin/env node` shebang and is present in the source tree
- WHEN the build completes
- THEN `dist/templates/statusline/statusline.mjs` can be invoked directly as an executable by the OS

### Scenario: Build succeeds when statusline source directory is empty

- GIVEN `src/templates/statusline/` exists but contains no `.mjs` files
- WHEN `npm run build` runs the template-copy step
- THEN the build exits without error and does not fail due to an empty glob match
