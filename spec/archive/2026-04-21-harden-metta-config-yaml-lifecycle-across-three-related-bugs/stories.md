# harden-metta-config-yaml-lifecycle-across-three-related-bugs — User Stories

## US-1: Idempotent install preserves a single stacks line

**As a** developer re-running `metta install` after pulling new changes
**I want to** have exactly one `stacks:` entry in `.metta/config.yaml` no matter how many times install runs
**So that** my project config stays valid YAML and downstream commands don't fail on duplicate keys
**Priority:** P1
**Independent Test Criteria:** After running `metta install` three times against a project whose `.metta/config.yaml` already contains a `stacks:` entry, the file contains exactly one `stacks:` line and parses as valid YAML with no duplicate top-level keys.

**Acceptance Criteria:**
- **Given** a project with `.metta/config.yaml` containing a single `stacks: [typescript]` entry **When** the developer runs `metta install` **Then** `.metta/config.yaml` still contains exactly one `stacks: [typescript]` entry
- **Given** a project whose `.metta/config.yaml` already has three duplicated `stacks:` lines from prior buggy installs **When** the developer runs `metta install` **Then** the duplicates are collapsed to a single `stacks:` entry and the file parses cleanly through `yaml.parseDocument`
- **Given** a fresh project with no `.metta/config.yaml` **When** the developer runs `metta install` twice in a row **Then** the resulting file has exactly one `stacks:` line and one of each other top-level key

---

## US-2: Corrupt config fails loudly with an actionable error

**As a** developer running any metta command against a project whose `.metta/config.yaml` is corrupt
**I want to** see a hard failure that names the file, the line, and the fix command
**So that** I don't silently run against defaults while my real config is broken
**Priority:** P1
**Independent Test Criteria:** Running `metta status`, `metta propose`, `metta plan`, `metta execute`, `metta verify`, `metta ship`, or `metta complete` against a project with a malformed `.metta/config.yaml` exits non-zero with an error message that contains the path `.metta/config.yaml`, a line number, and the literal string `metta doctor --fix`.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` contains two `stacks:` keys at the top level **When** the developer runs `metta status` **Then** the command exits non-zero and prints `.metta/config.yaml:<line>` along with the suggestion `run: metta doctor --fix`
- **Given** `.metta/config.yaml` contains a YAML syntax error (unterminated quote) on line 7 **When** the developer runs `metta propose "new change"` **Then** the command exits non-zero before any spec is written and the error cites `.metta/config.yaml:7`
- **Given** the same corrupt `.metta/config.yaml` **When** the developer runs `metta doctor` or `metta doctor --fix` **Then** those commands do NOT hard-fail on the parse error and instead proceed with their repair path

---

## US-3: metta doctor --fix repairs and commits config automatically

**As a** developer who just saw a hard failure citing a corrupt `.metta/config.yaml`
**I want to** run `metta doctor --fix` and have it dedupe duplicate map keys, drop schema-invalid keys, and commit the repair
**So that** I can recover from config corruption in one command without hand-editing YAML
**Priority:** P1
**Independent Test Criteria:** Running `metta doctor --fix` on a `.metta/config.yaml` with duplicated `stacks:` keys and one unknown top-level key produces a file with exactly one `stacks:` entry (last-write-wins), no unknown keys, and a git commit whose subject is exactly `chore: metta doctor repaired .metta/config.yaml`.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` has three `stacks:` entries with different values **When** the developer runs `metta doctor --fix` **Then** only the last `stacks:` entry is retained and the other two are removed from the file
- **Given** `.metta/config.yaml` contains a top-level key `foo: bar` that is not part of the config schema **When** the developer runs `metta doctor --fix` **Then** the `foo:` key is dropped and the file validates against the schema
- **Given** `metta doctor --fix` has successfully repaired `.metta/config.yaml` **When** the command returns **Then** the working tree shows a new commit with subject `chore: metta doctor repaired .metta/config.yaml` containing only `.metta/config.yaml` in the diff

---

## US-4: /metta-init captures per-project verification strategy

**As a** developer initializing metta in a new project via `/metta-init`
**I want to** be asked which verification strategy fits my app and given space for free-form instructions
**So that** verifier agents know how to exercise my running app later in the lifecycle
**Priority:** P2
**Independent Test Criteria:** After completing `/metta-init` Round 4 and selecting a strategy, `.metta/config.yaml` contains a `verification:` block with `strategy: <chosen enum>` and `instructions: <provided text>` that validates against the config schema.

**Acceptance Criteria:**
- **Given** a developer running `/metta-init` in a fresh project **When** Round 4 prompts for verification strategy **Then** the prompt offers the exact enum values `tmux_tui`, `playwright`, `cli_exit_codes`, and `tests_only` and requires one to be selected
- **Given** the developer chose `playwright` and entered free-form instructions "Run `npm run e2e` against the preview build on port 4173" **When** Round 4 finishes **Then** `.metta/config.yaml` contains `verification:\n  strategy: playwright\n  instructions: Run \`npm run e2e\` against the preview build on port 4173`
- **Given** the developer chose `tmux_tui` **When** `/metta-init` exits **Then** the written `verification:` block passes the config Zod schema and `metta status` succeeds against the new project

---

## US-5: Verifier agents receive verification context via instructions command

**As a** verifier agent spawned during `metta verify`
**I want to** receive the project's chosen `verification_strategy` and `verification_instructions` in my JSON context
**So that** I exercise the running app the way the project owner specified rather than guessing
**Priority:** P2
**Independent Test Criteria:** Running `metta instructions verification --json` against a project whose `.metta/config.yaml` has `verification.strategy: cli_exit_codes` and `verification.instructions: Run \`npm test\`` emits JSON whose payload contains the keys `verification_strategy: "cli_exit_codes"` and `verification_instructions: "Run \`npm test\`"`.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` has `verification.strategy: tmux_tui` and `verification.instructions: Launch \`./run.sh\` in a tmux pane and drive the TUI` **When** the orchestrator runs `metta instructions verification --json` **Then** the emitted JSON contains `"verification_strategy": "tmux_tui"` and `"verification_instructions": "Launch \`./run.sh\` in a tmux pane and drive the TUI"`
- **Given** a verifier agent reads the `metta instructions verification --json` output **When** it inspects its context **Then** both `verification_strategy` and `verification_instructions` are present as top-level fields distinct from the rest of the verifier instructions
- **Given** the `verification.strategy` is any of `tmux_tui`, `playwright`, `cli_exit_codes`, or `tests_only` **When** `metta instructions verification --json` runs **Then** the enum value is passed through verbatim without translation or defaulting

---

## US-6: Verifier detects legacy configs missing verification strategy

**As a** verifier agent running against a project that was initialized before verification discovery existed
**I want to** detect the missing `verification.strategy` and fail with the exact command the developer must run
**So that** the project owner fixes the gap instead of the verifier silently falling back to a generic strategy
**Priority:** P2
**Independent Test Criteria:** When `metta instructions verification --json` runs against a `.metta/config.yaml` that has no `verification:` block, a verifier agent consuming the output exits non-zero with an error message containing the literal command string `/metta-init` (or the specific re-configuration command) and references `.metta/config.yaml`.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` is missing the `verification:` block entirely **When** a verifier agent is spawned during `metta verify` **Then** the agent exits non-zero and its error output names `.metta/config.yaml` and the exact command to run to configure verification
- **Given** `.metta/config.yaml` has `verification:` but `strategy` is absent or empty **When** the verifier agent inspects its context **Then** it emits an error that lists the allowed enum values `tmux_tui | playwright | cli_exit_codes | tests_only` and stops before attempting verification
- **Given** the verifier's error message is printed **When** the developer reads it **Then** the message tells them exactly which CLI command (e.g. `metta init --verification-only` or `/metta-init`) to run to backfill `verification.strategy`

---

## US-7: Install writes stacks via shared setProjectField helper preserving comments

**As a** developer who has added inline comments to `.metta/config.yaml`
**I want to** `metta install` to preserve my comments and whitespace when it writes the `stacks:` field
**So that** I can annotate my config without every install run stripping my notes
**Priority:** P3
**Independent Test Criteria:** Given a `.metta/config.yaml` with a `# project-specific override` comment above the `stacks:` line, running `metta install` leaves the comment in place, keeps blank lines intact, and updates only the `stacks:` value through the shared `setProjectField(root, path, value)` helper backed by `yaml.parseDocument`.

**Acceptance Criteria:**
- **Given** `.metta/config.yaml` has a comment `# project-specific override` immediately above the `stacks:` line **When** the developer runs `metta install` **Then** the comment survives and remains immediately above the updated `stacks:` line
- **Given** `.metta/config.yaml` has a blank line separating two top-level keys **When** `metta install` updates `stacks:` via `setProjectField` **Then** the blank line separator is preserved in the rewritten file
- **Given** both `metta install` and `/metta-init` need to update the config **When** either command writes a field **Then** both code paths call the shared `setProjectField(root, path, value)` helper rather than any regex-based writer
