import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SpecMerger } from '../src/finalize/spec-merger.js'
import { SpecLockManager } from '../src/specs/spec-lock-manager.js'
import { parseSpec } from '../src/specs/spec-parser.js'

describe('SpecMerger', () => {
  let specDir: string
  let lockManager: SpecLockManager
  let merger: SpecMerger

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'metta-merge-'))
    lockManager = new SpecLockManager(specDir)
    merger = new SpecMerger(specDir, lockManager)

    // Create directory structure
    await mkdir(join(specDir, 'specs', 'auth'), { recursive: true })
    await mkdir(join(specDir, 'changes', 'add-mfa'), { recursive: true })
  })

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true })
  })

  it('merges ADDED requirement into new capability', async () => {
    const deltaContent = `# auth (Delta)

## ADDED: Requirement: Multi-Factor Authentication

The system MUST support TOTP-based MFA.

### Scenario: MFA setup
- GIVEN a user without MFA
- WHEN they navigate to security settings
- THEN they can set up TOTP
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    const result = await merger.merge('add-mfa', {})

    expect(result.status).toBe('clean')
    expect(result.merged.length).toBeGreaterThan(0)
  })

  it('detects conflict when base version has changed', async () => {
    // Create existing spec
    const existingSpec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    await writeFile(join(specDir, 'specs', 'auth', 'spec.md'), existingSpec)
    const parsed = parseSpec(existingSpec)
    const lock = lockManager.createFromParsed(parsed)
    await lockManager.write('auth', lock)

    // Create delta that modifies user-login
    const deltaContent = `# auth (Delta)

## MODIFIED: Requirement: User Login

The system MUST allow login with MFA.

### Scenario: Login with MFA
- GIVEN a user with MFA
- WHEN they login
- THEN they are prompted for TOTP
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    // Set base version to something different from current
    const result = await merger.merge('add-mfa', {
      'auth/spec.md': 'sha256:old-version',
    })

    expect(result.status).toBe('conflict')
    expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('performs clean merge when base version matches', async () => {
    const existingSpec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    await writeFile(join(specDir, 'specs', 'auth', 'spec.md'), existingSpec)
    const parsed = parseSpec(existingSpec)
    const lock = lockManager.createFromParsed(parsed)
    await lockManager.write('auth', lock)

    const deltaContent = `# auth (Delta)

## ADDED: Requirement: Session Management

The system MUST manage sessions.

### Scenario: Session expiry
- GIVEN a session
- WHEN it expires
- THEN user is logged out
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    const result = await merger.merge('add-mfa', {
      'auth/spec.md': lock.hash,
    })

    expect(result.status).toBe('clean')
  })

  it('supports dry-run mode', async () => {
    const deltaContent = `# newcap (Delta)

## ADDED: Requirement: New Feature

The system MUST do something new.

### Scenario: It works
- GIVEN nothing
- WHEN triggered
- THEN it works
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    const result = await merger.merge('add-mfa', {}, true)

    expect(result.status).toBe('clean')
    expect(result.merged.length).toBeGreaterThan(0)
    // In dry-run, no files should actually be created
  })

  it('returns clean merge when no spec exists', async () => {
    const result = await merger.merge('add-mfa', {})
    expect(result.status).toBe('clean')
    expect(result.merged).toEqual([])
  })

  it('applies MODIFIED delta by replacing requirement text', async () => {
    const existingSpec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    await writeFile(join(specDir, 'specs', 'auth', 'spec.md'), existingSpec)
    const parsed = parseSpec(existingSpec)
    const lock = lockManager.createFromParsed(parsed)
    await lockManager.write('auth', lock)

    const deltaContent = `# auth (Delta)

## MODIFIED: Requirement: User Login

The system MUST allow login with MFA support.

### Scenario: Login with MFA
- GIVEN a user with MFA enabled
- WHEN they login
- THEN they are prompted for a TOTP code
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    const result = await merger.merge('add-mfa', {
      'auth/spec.md': lock.hash,
    })

    expect(result.status).toBe('clean')
    expect(result.merged).toContain('auth/user-login')

    // Verify the spec was actually updated
    const { readFile } = await import('node:fs/promises')
    const updatedContent = await readFile(join(specDir, 'specs', 'auth', 'spec.md'), 'utf-8')
    expect(updatedContent).toContain('login with MFA support')
    expect(updatedContent).toContain('Login with MFA')
    // Old scenario should be gone
    expect(updatedContent).not.toMatch(/### Scenario: Success/)
  })

  it('applies RENAMED delta by replacing old requirement with new name', async () => {
    const existingSpec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    await writeFile(join(specDir, 'specs', 'auth', 'spec.md'), existingSpec)
    const parsed = parseSpec(existingSpec)
    const lock = lockManager.createFromParsed(parsed)
    await lockManager.write('auth', lock)

    const deltaContent = `# auth (Delta)

## RENAMED: Requirement: User Authentication

Renamed from: User Login

The system MUST authenticate users securely.

### Scenario: Secure login
- GIVEN a user
- WHEN they authenticate
- THEN they receive a secure token
`
    await writeFile(join(specDir, 'changes', 'add-mfa', 'spec.md'), deltaContent)

    const result = await merger.merge('add-mfa', {
      'auth/spec.md': lock.hash,
    })

    expect(result.status).toBe('clean')
    expect(result.merged).toContain('auth/user-authentication')

    const { readFile } = await import('node:fs/promises')
    const updatedContent = await readFile(join(specDir, 'specs', 'auth', 'spec.md'), 'utf-8')
    expect(updatedContent).toContain('## Requirement: User Authentication')
    expect(updatedContent).toContain('authenticate users securely')
    // Old requirement name should be gone
    expect(updatedContent).not.toMatch(/## Requirement: User Login/)
  })
})
