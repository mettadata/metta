# Artifact Store

## Requirement: Change Creation

The system MUST create a change directory under `changes/<slug>/` with a validated `.metta.yaml` metadata file when `createChange` is called with a description, workflow name, and artifact ID list.

Slug generation MUST apply the following rules in order:
- Lowercase the description
- Replace all non-alphanumeric character runs with a single hyphen
- Split on hyphens and remove stop words (`a`, `an`, `the`, `add`, `and`, `or`, `for`, `to`, `of`, `with`, `in`, `on`, `by`, `is`, `it`, `that`, `this`, `from`, `into`, `each`, `its`, `own`, `showing`, `using`, `without`)
- Rejoin with hyphens, strip leading and trailing hyphens
- Truncate to 30 characters and strip any resulting trailing hyphen

The metadata MUST be validated against `ChangeMetadataSchema` (Zod strict schema) before writing. Unvalidated writes MUST NOT occur.

The first artifact in the provided list MUST be set to `ready` status. All subsequent artifacts MUST be set to `pending` status. The `current_artifact` field MUST be set to the first artifact ID, or an empty string when the list is empty.

An optional `baseVersions` record MAY be supplied, mapping spec file paths (e.g. `auth/spec.md`) to their SHA-256 content hashes at the time the change was created. These MUST be stored verbatim in `base_versions`.

### Scenario: Successful change creation
- GIVEN a description "add user profiles" with workflow "standard" and artifacts ["intent", "spec", "design"]
- WHEN `createChange` is called
- THEN the slug is "user-profiles"
- AND `changes/user-profiles/.metta.yaml` is written with status "active"
- AND `artifacts.intent` equals "ready"
- AND `artifacts.spec` equals "pending"
- AND `current_artifact` equals "intent"

### Scenario: Slug strips stop words and special characters
- GIVEN a description "Fix Payment Rounding!!!"
- WHEN `createChange` is called with workflow "quick" and artifacts ["intent"]
- THEN the resulting slug is "fix-payment-rounding"

### Scenario: Duplicate change rejected
- GIVEN a change named "test-change" already exists
- WHEN `createChange` is called with description "test change"
- THEN an error is thrown with message containing "already exists"

### Scenario: Base versions recorded
- GIVEN a `baseVersions` map of `{ "auth/spec.md": "sha256:abc123" }`
- WHEN `createChange` is called
- THEN `metadata.base_versions["auth/spec.md"]` equals "sha256:abc123"

## Requirement: Change Listing

The system MUST return all active change names by reading the `changes/` directory and filtering to subdirectories that contain a `.metta.yaml` file.

The system MUST return an empty list when no changes directory exists or when no valid change directories are present.

### Scenario: Lists active changes
- GIVEN changes "change-one" and "change-two" have been created
- WHEN `listChanges` is called
- THEN both names are returned

### Scenario: Empty list when no changes
- GIVEN no changes have been created
- WHEN `listChanges` is called
- THEN an empty array is returned

## Requirement: Artifact Status Tracking

The system MUST update an individual artifact's status within a change's metadata when `markArtifact` is called.

When the new status is `in_progress` or `complete`, the `current_artifact` field MUST be updated to the given artifact ID. For all other status values, `current_artifact` MUST NOT be changed.

### Scenario: Mark artifact complete
- GIVEN a change "test" with artifacts ["intent", "spec"] and intent at "ready"
- WHEN `markArtifact("test", "intent", "complete")` is called
- THEN `artifacts.intent` equals "complete"
- AND `current_artifact` equals "intent"

## Requirement: Artifact File I/O

The system MUST write raw file content to `changes/<changeName>/<fileName>` via `writeArtifact` and read it back verbatim via `readArtifact`.

`artifactExists` MUST return `false` before the file is written and `true` after.

### Scenario: Write and read artifact
- GIVEN a change "test" exists
- WHEN `writeArtifact("test", "intent.md", "# Test\n")` is called
- THEN `readArtifact("test", "intent.md")` returns content containing "# Test"

### Scenario: Existence check
- GIVEN a change "test" exists
- WHEN `artifactExists("test", "intent.md")` is called before writing
- THEN the result is false
- WHEN `writeArtifact` is subsequently called
- THEN `artifactExists` returns true

## Requirement: Change Archival

The system MUST move an active change directory from `changes/<name>/` to `archive/<date>-<name>/` when `archive` is called, where `<date>` is the current UTC date in `YYYY-MM-DD` format.

After archival the change MUST NOT appear in `listChanges`.

### Scenario: Archive moves directory
- GIVEN a change "test" exists
- WHEN `archive("test")` is called
- THEN the returned archive name matches the pattern `YYYY-MM-DD-test`
- AND "test" no longer appears in `listChanges`

## Requirement: Change Abandonment

The system MUST set the change status to `abandoned` in metadata before moving the directory when `abandon` is called. The archive destination MUST follow the naming pattern `<date>-<name>-abandoned`.

### Scenario: Abandon appends suffix
- GIVEN a change "test" exists
- WHEN `abandon("test")` is called
- THEN the returned archive name matches `YYYY-MM-DD-test-abandoned`
