# Hook Blocking Strategy Research: `metta-guard-bash.mjs`

Change: `batch-skill-template-consistency-enforcement-1-pretooluse`
Scope: PreToolUse Bash hook that decides "block or allow" for `tool_input.command`

---

## Context

The existing `metta-guard-edit.mjs` hook (at `src/templates/hooks/metta-guard-edit.mjs` and its
byte-identical mirror `.claude/hooks/metta-guard-edit.mjs`) establishes the implementation
pattern. It reads a JSON event from stdin, inspects `tool_name`, short-circuits for non-guarded
tools, then runs a side-effectful check (`metta status --json`). The new hook is structurally
similar but the guard condition is different: instead of checking external state, it must classify
the `tool_input.command` string as blocked or allowed based purely on its content.

The blocked list from `spec.md` / `intent.md`:

```
metta (propose|quick|auto|complete|finalize|ship|issue|fix-issue|fix-gap|refresh|import|install|init)
metta backlog (add|done|promote)
metta changes abandon
```

Read-only pass-through list:

```
metta status, metta instructions, metta issues list, metta gate list,
metta progress, metta changes list, metta doctor
```

Unknown subcommands must NOT silently pass (spec requirement `BashHookPassesReadOnlyCommands`,
scenario "unknown metta subcommand is not silently allowed"). The bypass mechanism is
`METTA_SKILL=1` in env — checked first, before any command inspection.

---

## Strategy 1: Regex on `tool_input.command` string

### Description

Two regular expressions applied directly to the raw command string:

1. A blocklist regex that matches any position where a blocked metta subcommand appears.
2. A read-only allowlist regex that matches `metta` followed by a known safe subcommand.

Classification flow:
1. If `METTA_SKILL=1`, exit 0 immediately.
2. If command does not contain the word `metta`, exit 0 (not our concern).
3. If blocklist regex matches anywhere in the command string, exit 2 (blocked).
4. If allowlist regex matches, exit 0 (pass-through).
5. Otherwise (unknown subcommand), exit 2 conservatively.

Example regexes:

```js
const BLOCKED = /(?:^|[\s;&|`])metta\s+(propose|quick|auto|complete|finalize|ship|issue|fix-issue|fix-gap|refresh|import|install|init)(?:\s|$)|(?:^|[\s;&|`])metta\s+backlog\s+(add|done|promote)(?:\s|$)|(?:^|[\s;&|`])metta\s+changes\s+abandon(?:\s|$)/

const READONLY = /(?:^|[\s;&|`])metta\s+(status|instructions|progress|doctor)(?:\s|$)|(?:^|[\s;&|`])metta\s+issues\s+list(?:\s|$)|(?:^|[\s;&|`])metta\s+gate\s+list(?:\s|$)|(?:^|[\s;&|`])metta\s+changes\s+list(?:\s|$)/
```

### Pros

- O(1) per call — two regex tests, no parsing overhead.
- Zero dependencies — pure Node.js built-ins, like the existing hook.
- Easy to read for simple cases; reviewers can see the subcommand list in one place.
- Matches the pattern of the edit guard's `GUARDED` set check.

### Cons

- **Regex precision is fragile at the boundaries.** The lookahead/lookbehind anchors
  (`(?:^|[\s;&|])`) must cover every shell metacharacter that can precede `metta`: spaces,
  semicolons, `&&`, `||`, pipes, backticks, `$(...)`, newlines. Missing one allows a crafted
  invocation to slip through.
- **Leading env-var prefix is not handled by default.** `FOO=bar metta propose` begins with
  `FOO=bar`, so a `^metta` anchor fails; the regex must instead look for `metta` preceded by
  whitespace OR start-of-string, which is achievable but adds complexity.
- **`cd /foo && metta issue "..."` is handled** — the `&&` is matched by `[\s;&|]` — but only if
  the lookbehind is broad enough. Any metacharacter missed in the class breaks the match.
- **Quoted args with embedded spaces** are transparent to the regex: `metta issue "my problem"` is
  matched on `metta issue` before the quoted string, which is correct. However `"metta issue"` as a
  single quoted token is not matched (correctly — it's not a shell invocation of the binary).
- **`sudo metta propose`** — not in scope per spec but would slip through regex step 2 (no `metta`
  at a metacharacter boundary if `sudo` is written as `sudo metta`). Actually `sudo` is a word
  boundary before `metta`, so the regex does catch it — which is fine since sudo metta from an AI
  tool should also be blocked.
- **`npx metta propose`** — similar to sudo; the regex catches `metta propose` regardless of
  prefix, which is correct behavior.
- **Regex maintenance burden increases with each new subcommand.** Adding `metta backlog promote`
  later requires regex surgery, which is error-prone.
- The multi-word subcommands `backlog add`, `changes abandon`, `issues list`, `gate list`,
  `changes list` each need their own alternation, making the pattern long and hard to audit.

### Edge Case Analysis

| Input | Expected | Regex Result | Risk |
|---|---|---|---|
| `metta propose "add feature"` | block | correct (matches at start) | none |
| `FOO=bar metta propose` | block | correct if `\s` in lookbehind (space before `metta`) | low |
| `cd /foo && metta issue "..."` | block | correct if `&` in char class | low |
| `metta status` | allow | correct (allowlist matches) | none |
| `metta status && metta issue` | block | correct (blocked regex wins first) | none |
| `metta unknowncmd` | block conservatively | correct (no allowlist match, falls to block) | none |
| `echo "run metta propose later"` | should not block (string arg) | **false positive risk** — regex matches `metta propose` inside the echo arg | medium |
| `# metta propose` | comment, not an invocation | **false positive risk** — regex matches | low (AI unlikely to send comments-only) |
| `node -e 'metta propose'` | allow (not invoking metta binary) | **false positive** — regex matches substring | low-medium |

The `echo "run metta propose later"` false positive is the main practical concern. In real Claude
Bash tool usage an AI would rarely echo the literal text `metta propose`, but it cannot be excluded.

### Complexity: Low implementation, medium correctness confidence

---

## Strategy 2: Minimal command-string tokenizer (RECOMMENDED)

### Description

Split the command string into tokens using a lightweight tokenizer that understands:
- Single-quoted strings (`'...'`) — opaque, no escape processing needed
- Double-quoted strings (`"..."`) — opaque for splitting purposes
- Shell metacharacters: `;`, `&&`, `||`, `|`, newline — treated as statement terminators
- Leading `KEY=VALUE` tokens before a command — skipped when identifying the binary

For each "statement" (segment between metacharacters), find the first non-assignment token and
check if it equals `metta`. If it does, look at the next token (the subcommand). Classify via a
static map:

```js
const BLOCK_MAP = new Set(['propose','quick','auto','complete','finalize','ship',
  'issue','fix-issue','fix-gap','refresh','import','install','init'])

const ALLOW_MAP = new Set(['status','instructions','progress','doctor'])

// Two-token allow commands (subcommand + second arg must match)
const ALLOW_TWO = { issues: 'list', gate: 'list', changes: 'list' }

// Two-token block commands
const BLOCK_TWO = { backlog: new Set(['add','done','promote']), changes: new Set(['abandon']) }
```

Classification per statement containing `metta` as the command:
1. `METTA_SKILL=1` (env) → exit 0 before any parsing.
2. Non-Bash tool → exit 0.
3. No statement has `metta` as command binary → exit 0.
4. Subcommand in `BLOCK_MAP` → exit 2.
5. Subcommand in `BLOCK_TWO` and second arg in the matching set → exit 2.
6. Subcommand in `ALLOW_MAP` → exit 0.
7. Subcommand in `ALLOW_TWO` and second arg matches → exit 0.
8. Anything else (unknown subcommand, unrecognized compound) → exit 2 conservatively.

The tokenizer only needs to be "good enough" — it does not need to be POSIX-correct, just correct
for the realistic inputs an AI Bash tool sends.

### Pros

- **No false positives from string literals.** `echo "run metta propose"` is tokenized as
  `echo` as the binary, not `metta`. The embedded string is opaque.
- **Leading env vars handled cleanly.** `FOO=bar metta propose` tokenizes to `[FOO=bar,
  metta, propose]`; the tokenizer skips `FOO=bar` and identifies `metta` as the binary.
- **`cd /foo && metta issue "..."` handled cleanly.** `&&` is a statement separator; the
  tokenizer processes the second statement independently, finds `metta` as the binary.
- **Static maps are easy to extend.** Adding a new blocked subcommand is a one-line addition to
  `BLOCK_MAP`. No regex surgery.
- **Readability.** The logic reads like a decision table. Future maintainers can understand and
  audit it without regex expertise.
- **Conservative by default.** Unknown subcommands fall through to block (exit 2), satisfying
  spec requirement `BashHookPassesReadOnlyCommands` scenario "unknown metta subcommand".
- **Consistent with existing hook style.** The hook pattern (stdin JSON parse, early exits,
  final block with stderr + exit 2) is identical to `metta-guard-edit.mjs`. Only the decision
  logic differs.

### Cons

- More code than regex: the tokenizer is ~30-50 lines instead of 2 regex literals.
- The tokenizer must handle edge cases: unterminated quotes, backslash escapes, heredocs.
  For this use case, a "best effort" approach that handles the 99% case (normal AI-generated
  shell commands) is sufficient — the hook tolerates false negatives in edge cases better than
  false positives that break legitimate work.
- `$(...)` subshell substitutions are not easily tokenized. A command like
  `metta $(echo propose)` would not be caught — acceptable since this is adversarial input
  an AI tool would not plausibly generate.

### Edge Case Analysis

| Input | Expected | Tokenizer Result | Risk |
|---|---|---|---|
| `metta propose "add feature"` | block | `metta` binary, `propose` subcommand → block | none |
| `FOO=bar metta propose` | block | skip `FOO=bar`, `metta` binary, `propose` → block | none |
| `cd /foo && metta issue "..."` | block | `cd` statement passes, `metta issue` statement blocked | none |
| `metta status` | allow | `metta` binary, `status` in ALLOW_MAP → allow | none |
| `metta status && metta issue` | block | first statement allowed, second blocked → block wins | none |
| `metta unknowncmd` | block | not in BLOCK_MAP, not in ALLOW_MAP → block conservatively | none |
| `echo "run metta propose later"` | allow | `echo` is binary, not `metta` → allow | none |
| `node -e 'metta propose'` | allow | `node` is binary → allow | none |
| `metta backlog add "item"` | block | `metta` binary, `backlog` → BLOCK_TWO, `add` in set → block | none |
| `metta changes list` | allow | `metta` binary, `changes` → ALLOW_TWO, `list` → allow | none |
| `metta changes abandon foo` | block | `metta` binary, `changes` → BLOCK_TWO, `abandon` in set → block | none |
| `sudo metta propose` | allow (sudo is binary) | `sudo` binary, not `metta` → allow | acceptable — `sudo` in AI sessions is unusual |
| `npx metta propose` | allow (npx is binary) | `npx` binary → allow | acceptable — not standard metta invocation |

The `sudo`/`npx` cases are acceptable misses. The spec explicitly labels them "probably ignore".
An AI orchestrator would never `sudo metta propose` — if it did, it would already have bypassed
other safeguards, and `METTA_SKILL=1` is the right tool for legitimate skill-driven calls.

### Pseudocode

```js
function tokenizeStatement(cmd) {
  // Returns array of string tokens for one shell statement.
  // Handles single-quote, double-quote, and backslash escaping minimally.
  const tokens = []
  let current = ''
  let i = 0
  while (i < cmd.length) {
    const ch = cmd[i]
    if (ch === "'" ) {
      // Single-quoted: consume until closing '
      i++
      while (i < cmd.length && cmd[i] !== "'") current += cmd[i++]
      i++ // skip closing '
    } else if (ch === '"') {
      // Double-quoted: consume until closing "
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) { i++ }
        current += cmd[i++]
      }
      i++ // skip closing "
    } else if (ch === '\\' && i + 1 < cmd.length) {
      current += cmd[++i]; i++
    } else if (' \t\n'.includes(ch)) {
      if (current) tokens.push(current)
      current = ''
      i++
    } else {
      current += ch; i++
    }
  }
  if (current) tokens.push(current)
  return tokens
}

function splitStatements(cmd) {
  // Split on &&, ||, ;, |, newline — simple string split without full parse.
  // Two-char operators first to avoid double-split.
  return cmd.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
}

function isAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function classify(command) {
  // Returns 'block', 'allow', or 'unknown' for the overall command string.
  const statements = splitStatements(command)
  let decision = 'allow'
  for (const stmt of statements) {
    const tokens = tokenizeStatement(stmt)
    // Skip leading env-var assignments
    let idx = 0
    while (idx < tokens.length && isAssignment(tokens[idx])) idx++
    const binary = tokens[idx]
    if (binary !== 'metta') continue  // not a metta call, skip this statement
    const sub = tokens[idx + 1] ?? ''
    const sub2 = tokens[idx + 2] ?? ''
    if (BLOCK_MAP.has(sub)) { return 'block' }
    if (BLOCK_TWO[sub]?.has(sub2)) { return 'block' }
    if (ALLOW_MAP.has(sub)) { decision = 'allow'; continue }
    if (ALLOW_TWO[sub] === sub2) { decision = 'allow'; continue }
    // Unknown or empty subcommand — block conservatively
    return 'block'
  }
  return decision  // 'allow' if no metta statement was found or all were read-only
}
```

Main hook body (after stdin read and non-Bash early exit):

```js
if (process.env.METTA_SKILL === '1') process.exit(0)

const command = input?.tool_input?.command ?? ''
const result = classify(command)
if (result === 'block') {
  const sub = /* extract primary subcommand for error message */ '...'
  process.stderr.write(
    `metta-guard: Bash blocked — direct CLI call to \`metta ${sub}\` is not allowed from AI sessions.\n` +
    `Use the matching skill instead (e.g., /metta-${sub}).\n` +
    `Set METTA_SKILL=1 to bypass from within a skill.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  )
  process.exit(2)
}
process.exit(0)
```

### Complexity: Medium implementation, high correctness confidence

---

## Strategy 3: Full shell AST parse

### Description

Use a shell parsing library (e.g., `mvdan-sh` compiled to WASM, or a pure-JS port) to parse the
command string into a full AST, walk `CallExpr` nodes, and extract the literal `metta` binary
invocations with their exact argument lists.

### Pros

- Handles all valid POSIX shell syntax correctly: heredocs, subshells `$(...)`, process
  substitution, complex quoting, brace expansion, arithmetic.
- No false positives and no false negatives for any syntactically valid input.
- Definitive — if the shell would invoke `metta propose`, the AST walk finds it.

### Cons

- **Overkill for this use case.** The inputs are AI-generated Bash tool commands. Claude does
  not produce `metta $(cat /dev/urandom | head -c 4)` or POSIX heredocs. The inputs are
  essentially simple: one or two commands joined with `&&`, maybe with env-var prefixes.
- **External dependency.** The hook must be a self-contained `.mjs` file with no `node_modules`
  (it runs in the Claude hooks environment, not in a bundled app). A shell-parser npm package
  cannot be imported unless it is bundled into the hook file or installed globally.
- **Startup latency.** Parsing a WASM module or loading a large JS AST library adds 100-500ms
  to every Bash tool event. The existing hook uses `execAsync('metta', ['status', '--json'])`
  which already adds latency; a WASM parser stacks on top.
- **Maintenance surface.** A WASM build or bundled parser must be kept in sync with the build
  pipeline. The existing hook's value is precisely that it has zero dependencies.
- **Complexity mismatch.** The spec's test suite (`tests/metta-guard-bash.test.ts`) is modeled
  on the simple `spawnSync` pattern in `tests/metta-guard-edit.test.ts`. A WASM dependency
  would require the test setup to provision the WASM binary as well.

### Edge Case Analysis

Same as Strategy 2 for all cases an AI tool would realistically send. Gains correctness on
adversarial inputs (`$(...)`, heredocs) that are out of scope.

### Complexity: High implementation, very high correctness for adversarial inputs (not needed)

---

## Tradeoff Table

| Criterion | Regex | Tokenizer | Full AST |
|---|---|---|---|
| Implementation lines | ~15 | ~60 | ~200+ (plus WASM/bundle) |
| External dependencies | none | none | shell-parser npm package or WASM |
| False positive rate | medium (echo/node -e) | very low | zero |
| False negative rate (blocked slips through) | very low | very low | zero |
| `FOO=bar metta` handled | yes (space before metta) | yes (skip assignments) | yes |
| `cd && metta` handled | yes (if `&` in char class) | yes (statement split) | yes |
| Quoted args with spaces | transparent (correct) | transparent (correct) | correct |
| `sudo metta` / `npx metta` | blocked (metta is matched) | allowed (binary is sudo/npx) | allowed |
| Unknown subcommands blocked | yes (fall-through) | yes (fall-through) | yes |
| Maintenance cost per new subcommand | regex surgery | one-line Set entry | one-line Set entry |
| Startup overhead | negligible | negligible | 100-500ms (WASM) |
| Consistent with existing hook style | yes | yes | no (requires bundler) |
| Audit confidence for non-regex devs | low | high | medium |

---

## Recommendation: Strategy 2 — Minimal command-string tokenizer

**Rationale:** The tokenizer eliminates the false-positive class that regex cannot prevent
(matching `metta propose` inside a string argument to `echo` or `node -e`), handles all
realistic edge cases (`FOO=bar` env prefixes, `&&`-chained statements, quoted args with embedded
spaces), and does so with zero dependencies and negligible overhead. It is maintainable by any
developer without regex expertise — the classification logic reads as a decision table. The
implementation cost over regex (~45 additional lines) is justified by the correctness gain and
lower maintenance burden when the subcommand list evolves.

Strategy 1 (regex) is acceptable if the false-positive scenario is deemed theoretical. In
practice it is plausible: an AI orchestrator building a diagnostic message or running `echo` to
log a command before executing it could trigger a false positive that silently blocks a read
path. Given that the hook fires on every Bash tool call, false positives erode trust in the hook
faster than the rare missing edge case.

Strategy 3 (AST) is rejected: external dependency, bundling complexity, and startup latency all
conflict with the existing hook's design contract of being a zero-dependency, fast, self-contained
`.mjs` file.

The tokenizer does **not** catch `sudo metta propose` or `npx metta propose` (the binary seen is
`sudo`/`npx`, not `metta`). The spec explicitly marks these as "probably ignore", and the
`METTA_SKILL=1` env bypass is the correct mechanism for any legitimately wrapped invocation.

---

## Pseudocode Sketch (Strategy 2)

See the full pseudocode in the Strategy 2 section above. Summary of file structure:

```
src/templates/hooks/metta-guard-bash.mjs
├── readStdin()                  — same helper as metta-guard-edit.mjs
├── BLOCK_MAP (Set)              — single-token blocked subcommands
├── BLOCK_TWO (object)           — two-token blocked (backlog/changes subcommands)
├── ALLOW_MAP (Set)              — single-token read-only subcommands
├── ALLOW_TWO (object)           — two-token read-only (issues list, gate list, changes list)
├── isAssignment(token)          — /^[A-Za-z_]\w*=/ test
├── tokenizeStatement(stmt)      — quote-aware whitespace split, ~25 lines
├── splitStatements(cmd)         — split on &&, ||, ;, |, \n
├── classify(command)            — returns 'block' | 'allow'
└── main()
    ├── readStdin
    ├── early exit: not Bash tool → exit 0
    ├── early exit: METTA_SKILL=1 → exit 0
    ├── classify(command) === 'block' → stderr + exit 2
    └── exit 0
```

Test cases to cover (mirroring `metta-guard-edit.test.ts` style with `spawnSync`):

- Non-Bash tool event passes (exit 0)
- `METTA_SKILL=1` with blocked command passes (exit 0)
- `metta propose "x"` blocked (exit 2, stderr contains `/metta-propose`)
- `metta issue "x"` blocked (exit 2, stderr contains `/metta-issue`)
- `metta backlog add "item"` blocked (exit 2)
- `metta changes abandon slug` blocked (exit 2)
- `metta status` passes (exit 0)
- `metta changes list` passes (exit 0)
- `metta unknowncmd` blocked conservatively (exit 2)
- `FOO=bar metta propose` blocked (exit 2)
- `cd /repo && metta issue "x"` blocked (exit 2)
- `echo "metta propose"` passes (exit 0, echo is binary)
- Both source and deployed hook are byte-identical
