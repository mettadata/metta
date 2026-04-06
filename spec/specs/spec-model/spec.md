# Spec Model

## Requirement: Spec Markdown Parsing

The system MUST parse a spec Markdown document into a `ParsedSpec` structure containing a title and an ordered list of `ParsedRequirement` objects using the `remark`/`unified` pipeline.

The parser MUST recognise:
- A level-1 heading as the spec title
- Level-2 headings prefixed with `Requirement:` as requirement boundaries
- Level-3 headings prefixed with `Scenario:` as scenario boundaries within the enclosing requirement
- Unordered list items immediately following a `Scenario:` heading as the scenario's step strings

Requirement IDs MUST be derived by lower-casing the requirement name and replacing all non-alphanumeric runs with hyphens, stripping leading and trailing hyphens.

The RFC 2119 keyword for a requirement MUST be extracted from the first paragraph after the `Requirement:` heading. The precedence order is `MUST` > `SHOULD` > `MAY`. When no keyword is found the keyword MUST default to `SHOULD`.

### Scenario: Full spec parsed
- GIVEN a Markdown document with title "Authentication" and two requirements "User Login" (MUST) and "Session Management" (SHOULD), each with scenarios
- WHEN `parseSpec` is called
- THEN `result.title` equals "Authentication"
- AND `result.requirements` has length 2
- AND `result.requirements[0].id` equals "user-login"
- AND `result.requirements[0].keyword` equals "MUST"
- AND `result.requirements[0].scenarios[0].steps` has 4 entries beginning with "GIVEN"

### Scenario: MAY keyword extracted
- GIVEN a requirement paragraph containing the word "MAY"
- WHEN `parseSpec` is called
- THEN `requirement.keyword` equals "MAY"

### Scenario: Empty spec handled
- GIVEN a Markdown document with only a level-1 heading
- WHEN `parseSpec` is called
- THEN `result.requirements` is an empty array

## Requirement: Requirement Content Hashing

The system MUST produce a stable, deterministic SHA-256 content hash for each parsed requirement by hashing the concatenation of the requirement text and its serialised scenarios.

The hash MUST be formatted as `sha256:<12-hex-chars>` (first 12 characters of the full hex digest).

Parsing the same Markdown twice MUST produce identical hashes. Changing any word in the requirement text or any scenario step MUST produce a different hash.

A spec-level hash MUST be computed by `hashSpec` as `sha256:<12-hex-chars>` of all requirement hashes joined with `:`.

### Scenario: Stable hashes
- GIVEN the same Markdown parsed twice
- WHEN `hashSpec` is called on each result
- THEN both hashes are identical

### Scenario: Different content produces different hash
- GIVEN two specs differing only in the requirement body text
- WHEN each is parsed
- THEN the per-requirement hashes differ

## Requirement: Delta Spec Parsing

The system MUST parse a delta Markdown document (title ending with `(Delta)`) into a `ParsedDeltaSpec` containing an ordered list of `ParsedDelta` objects, each pairing a `DeltaOperation` (`ADDED`, `MODIFIED`, `REMOVED`, or `RENAMED`) with a `ParsedRequirement`.

Delta headings MUST follow the pattern `<OPERATION>: Requirement: <Name>` at level 2.

Scenario headings within a delta requirement MAY be prefixed with `ADDED Scenario:` or plain `Scenario:`. Both forms MUST be accepted and the prefix stripped when extracting the scenario name.

### Scenario: Mixed delta operations parsed
- GIVEN a delta document with ADDED, MODIFIED, and REMOVED requirements
- WHEN `parseDeltaSpec` is called
- THEN `result.deltas` has length 3
- AND `result.deltas[0].operation` equals "ADDED"
- AND `result.deltas[1].operation` equals "MODIFIED"
- AND `result.deltas[2].operation` equals "REMOVED"

### Scenario: ADDED scenario prefix stripped
- GIVEN a requirement in a delta document with heading "### ADDED Scenario: Login with expired TOTP"
- WHEN `parseDeltaSpec` is called
- THEN the scenario name is "Login with expired TOTP" without the "ADDED" prefix

## Requirement: Spec Lock Management

The system MUST persist a `spec.lock` file alongside each capability spec at `specs/<capability>/spec.lock`, validated against `SpecLockSchema` (Zod strict).

The lock MUST contain:
- `version`: monotonically incrementing integer starting at 1
- `hash`: the spec-level hash from `hashSpec`
- `updated`: ISO 8601 datetime of the write
- `requirements`: array of `{ id, hash, scenarios[] }` derived from the parsed spec

`update` MUST read the existing lock version and increment it, or start at version 1 when no lock exists.

`getBaseVersion` MUST return the current `hash` string from the lock, or `null` when no lock exists.

Scenario slugs stored in the lock MUST be lower-cased with non-alphanumeric runs replaced by hyphens and leading/trailing hyphens stripped.

### Scenario: Lock created from spec
- GIVEN a parsed spec with two requirements
- WHEN `createFromParsed` is called with version 1
- THEN the lock `hash` equals `hashSpec(spec)`
- AND `lock.requirements` has length 2
- AND each entry carries the requirement's `id` and `hash`

### Scenario: Version incremented on update
- GIVEN a lock already exists at version 1
- WHEN `update` is called with a new parsed spec
- THEN the written lock has version 2

### Scenario: getBaseVersion returns null when no lock
- GIVEN no lock file exists for a capability
- WHEN `getBaseVersion` is called
- THEN the result is null
