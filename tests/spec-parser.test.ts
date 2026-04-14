import { describe, it, expect } from 'vitest'
import { parseSpec, parseDeltaSpec, hashSpec } from '../src/specs/spec-parser.js'

describe('parseSpec', () => {
  it('parses a spec with requirements and scenarios', () => {
    const markdown = `# Authentication

## Requirement: User Login

The system MUST allow registered users to authenticate with email and password.

### Scenario: Successful login
- GIVEN a registered user with email "user@example.com"
- WHEN they submit valid credentials
- THEN they receive a session token
- AND are redirected to the dashboard

### Scenario: Invalid password
- GIVEN a registered user
- WHEN they submit an incorrect password
- THEN they receive a 401 error
- AND the attempt is logged

## Requirement: Session Management

The system SHOULD expire sessions after 24 hours of inactivity.

### Scenario: Session expiry
- GIVEN a user with an active session
- WHEN 24 hours pass without activity
- THEN the session is invalidated
- AND the user must re-authenticate
`
    const result = parseSpec(markdown)

    expect(result.title).toBe('Authentication')
    expect(result.requirements).toHaveLength(2)

    const login = result.requirements[0]
    expect(login.name).toBe('User Login')
    expect(login.id).toBe('user-login')
    expect(login.keyword).toBe('MUST')
    expect(login.scenarios).toHaveLength(2)
    expect(login.scenarios[0].name).toBe('Successful login')
    expect(login.scenarios[0].steps).toHaveLength(4)
    expect(login.scenarios[0].steps[0]).toContain('GIVEN')

    const session = result.requirements[1]
    expect(session.name).toBe('Session Management')
    expect(session.keyword).toBe('SHOULD')
    expect(session.scenarios).toHaveLength(1)
  })

  it('extracts MAY keyword', () => {
    const markdown = `# Test

## Requirement: Optional Feature

The system MAY provide suggestions.

### Scenario: Suggestion shown
- GIVEN a user on the dashboard
- WHEN they have no recent activity
- THEN a suggestion is displayed
`
    const result = parseSpec(markdown)
    expect(result.requirements[0].keyword).toBe('MAY')
  })

  it('generates stable hashes', () => {
    const markdown = `# Test

## Requirement: Feature A

The system MUST do A.

### Scenario: A works
- GIVEN precondition
- WHEN action
- THEN result
`
    const result1 = parseSpec(markdown)
    const result2 = parseSpec(markdown)

    expect(result1.requirements[0].hash).toBe(result2.requirements[0].hash)
    expect(hashSpec(result1)).toBe(hashSpec(result2))
  })

  it('produces different hashes for different content', () => {
    const md1 = `# Test

## Requirement: A

The system MUST do A.

### Scenario: S1
- GIVEN x
- WHEN y
- THEN z
`
    const md2 = `# Test

## Requirement: A

The system MUST do B.

### Scenario: S1
- GIVEN x
- WHEN y
- THEN z
`
    const r1 = parseSpec(md1)
    const r2 = parseSpec(md2)
    expect(r1.requirements[0].hash).not.toBe(r2.requirements[0].hash)
  })

  it('handles empty specs', () => {
    const result = parseSpec('# Empty Spec\n')
    expect(result.title).toBe('Empty Spec')
    expect(result.requirements).toHaveLength(0)
  })

  it('preserves inline code backticks in requirement text and scenario steps', () => {
    const markdown = `# CLI

## Requirement: Install Command

The system MUST support \`metta install\` and \`metta init\` as bootstrap commands.

### Scenario: Init with JSON flag
- GIVEN a fresh repository
- WHEN the user runs \`metta init --json\`
- THEN a JSON manifest is written

## Requirement: Lock Validation

\`SpecMerger\` MUST validate the lock hash before applying any delta.

### Scenario: Hash mismatch aborts merge
- GIVEN a stale lock hash
- WHEN the merger runs
- THEN the operation aborts
`
    const result = parseSpec(markdown)

    const install = result.requirements[0]
    expect(install.text).toContain('`metta install`')
    expect(install.text).toContain('`metta init`')
    expect(install.scenarios[0].steps[1]).toBe('WHEN the user runs `metta init --json`')

    const lock = result.requirements[1]
    expect(lock.text.startsWith('`SpecMerger`')).toBe(true)

    // Also exercise parseDeltaSpec for scenario 2 coverage.
    const deltaMarkdown = `# CLI (Delta)

## MODIFIED: Requirement: Install Command

The system MUST support \`metta install\` as the bootstrap command.

### Scenario: Init with JSON flag
- GIVEN a fresh repository
- WHEN the user runs \`metta init --json\`
- THEN a JSON manifest is written
`
    const delta = parseDeltaSpec(deltaMarkdown)
    expect(delta.deltas[0].requirement.text).toContain('`metta install`')
    expect(delta.deltas[0].requirement.scenarios[0].steps[1]).toBe(
      'WHEN the user runs `metta init --json`',
    )
  })
})

describe('parseDeltaSpec', () => {
  it('parses ADDED, MODIFIED, and REMOVED deltas', () => {
    const markdown = `# Authentication (Delta)

## ADDED: Requirement: Multi-Factor Authentication

The system MUST support TOTP-based multi-factor authentication.

### Scenario: MFA setup
- GIVEN a user without MFA configured
- WHEN they navigate to security settings
- THEN they can scan a QR code to set up TOTP

## MODIFIED: Requirement: User Login

The system MUST allow login followed by optional MFA verification.

### Scenario: Successful login (no MFA)
- GIVEN a registered user without MFA
- WHEN they submit valid credentials
- THEN they receive a session token

## REMOVED: Requirement: Session Management
Moved to separate session capability.
`
    const result = parseDeltaSpec(markdown)

    expect(result.title).toBe('Authentication (Delta)')
    expect(result.deltas).toHaveLength(3)

    expect(result.deltas[0].operation).toBe('ADDED')
    expect(result.deltas[0].requirement.name).toBe('Multi-Factor Authentication')
    expect(result.deltas[0].requirement.keyword).toBe('MUST')

    expect(result.deltas[1].operation).toBe('MODIFIED')
    expect(result.deltas[1].requirement.name).toBe('User Login')

    expect(result.deltas[2].operation).toBe('REMOVED')
    expect(result.deltas[2].requirement.name).toBe('Session Management')
  })

  it('handles ADDED scenarios within requirements', () => {
    const markdown = `# Test (Delta)

## MODIFIED: Requirement: Login

Updated login.

### ADDED Scenario: Login with expired TOTP
- GIVEN a user with MFA enabled
- WHEN they submit an expired TOTP code
- THEN they receive a 401 error
`
    const result = parseDeltaSpec(markdown)
    expect(result.deltas).toHaveLength(1)
    expect(result.deltas[0].requirement.scenarios).toHaveLength(1)
    expect(result.deltas[0].requirement.scenarios[0].name).toBe('Login with expired TOTP')
  })
})
