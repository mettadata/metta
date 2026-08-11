# fix-repo-wide-duplicate-requirement-scan — Spec Delta

Data-repair change: no new capability requirements are introduced or modified. The requirements below govern the repair itself.

## Requirement: spec-store-deduplication

Each capability spec in the spec store MUST contain exactly one `## Requirement:` block per requirement name. The three corrupted specs (`fix-issues-command`, `install-init`, `user-stories`) MUST be repaired by keeping the first occurrence of each duplicated requirement block and deleting all later copies. Because every duplicate copy was verified byte-identical to its first occurrence, deletion MUST NOT alter any requirement or scenario content. Each repaired file MUST end with exactly one trailing newline.

### Scenario: fix-issues-command spec is deduplicated

- **Given** `spec/specs/fix-issues-command/spec.md` containing each of its 4 requirements 3 times
- **When** the repair is applied
- **Then** the file contains exactly 4 `## Requirement:` headings, one each for `fix-issue-cli-command`, `issues-store-archival`, `skill-template`, and `cli-registration`, with their original scenario content intact

### Scenario: install-init spec is deduplicated

- **Given** `spec/specs/install-init/spec.md` containing `init-command-drives-discovery` and `init-skill-invokes-init-command` twice each
- **When** the repair is applied
- **Then** the file contains exactly 9 `## Requirement:` headings with no duplicated names and all other requirements untouched

### Scenario: user-stories spec is deduplicated

- **Given** `spec/specs/user-stories/spec.md` containing each of its 7 requirements twice
- **When** the repair is applied
- **Then** the file contains exactly 7 `## Requirement:` headings with no duplicated names and the first-copy content intact

## Requirement: lock-files-regenerated

The `spec.lock` file for each repaired capability MUST be regenerated so its recorded hashes/requirement inventory match the deduplicated spec content.

### Scenario: locks match repaired specs

- **Given** the three deduplicated spec files
- **When** lock regeneration runs
- **Then** each capability's `spec.lock` reflects the deduplicated file and no other capability's lock changes

## Requirement: claude-md-counts-refreshed

CLAUDE.md's Active Specs table MUST be regenerated so the requirement counts for the three repaired capabilities reflect their true (deduplicated) requirement inventory.

### Scenario: refreshed counts

- **Given** the repaired specs and regenerated locks
- **When** the refresh flow runs
- **Then** the CLAUDE.md Active Specs rows for `fix-issues-command`, `install-init`, and `user-stories` show counts derived from the deduplicated specs

## Requirement: no-source-changes

The repair MUST NOT modify any TypeScript source, test, or template file. All existing gates (tests, typecheck, lint, build) MUST still pass after the repair.

### Scenario: gates still pass

- **Given** the repaired spec store
- **When** `npm test` and `npx tsc --noEmit` run
- **Then** both exit 0 with no new failures
