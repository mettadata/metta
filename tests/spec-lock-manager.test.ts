import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SpecLockManager } from '../src/specs/spec-lock-manager.js'
import { parseSpec } from '../src/specs/spec-parser.js'

describe('SpecLockManager', () => {
  let specDir: string
  let lockManager: SpecLockManager

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'metta-lock-'))
    lockManager = new SpecLockManager(specDir)
    await mkdir(join(specDir, 'specs', 'auth'), { recursive: true })
  })

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true })
  })

  it('increments version on successive updates', async () => {
    const specV1 = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    const parsed1 = parseSpec(specV1)
    const lock1 = await lockManager.update('auth', parsed1)
    expect(lock1.version).toBe(1)

    const specV2 = `# Auth

## Requirement: User Login

The system MUST allow login with MFA.

### Scenario: Success
- GIVEN a user
- WHEN they login with MFA
- THEN they get a token
`
    const parsed2 = parseSpec(specV2)
    const lock2 = await lockManager.update('auth', parsed2)
    expect(lock2.version).toBe(2)
  })

  it('sets status to draft and source to change by default', async () => {
    const spec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    const parsed = parseSpec(spec)
    const lock = await lockManager.update('auth', parsed)

    expect(lock.status).toBe('draft')
    expect(lock.source).toBe('change')
  })

  it('allows specifying a custom source in createFromParsed', async () => {
    const spec = `# Auth

## Requirement: User Login

The system MUST allow login.

### Scenario: Success
- GIVEN a user
- WHEN they login
- THEN they get a token
`
    const parsed = parseSpec(spec)
    const lock = lockManager.createFromParsed(parsed, 1, 'scan')

    expect(lock.source).toBe('scan')
    expect(lock.status).toBe('draft')
  })
})
