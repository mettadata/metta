import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-session-mint PreToolUse hook tests: the Tier-2 credential-minting half
// of the two-tier trust model (metta-guard-bash.mjs is the validating half).
// The source template and the deployed mirror must stay byte-identical; tests
// run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-session-mint.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-session-mint.mjs'),
]

const TTL_MS = 300000

// Per-skill scope table (must mirror SKILL_SCOPES in metta-session-mint.mjs,
// per design.md's Data Model section).
const EXPECTED_SCOPES: Record<string, string[]> = {
  'metta-next': ['complete', 'finalize'],
  'metta-plan': ['complete'],
  'metta-execute': ['complete'],
  'metta-verify': ['verify', 'complete'],
  'metta-refresh': ['refresh'],
  'metta-import': ['import'],
  'metta-init': ['init', 'refresh'],
  'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote'],
  'metta-fix-gap': ['fix-gap', 'complete', 'finalize'],
}

const V4_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface TokenFile {
  token: string
  skill: string
  subcommands: string[]
  mintedAt: number
  ttlMs: number
}

function runHook(
  hookPath: string,
  slug: string,
  payload: unknown,
  opts: { rawStdin?: string; cwd?: string } = {},
): { code: number; stderr: string } {
  const input = opts.rawStdin !== undefined ? opts.rawStdin : JSON.stringify(payload)
  const result = spawnSync('node', [hookPath, slug], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.cwd,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

function bashEvent(command: string, cwd: string, toolName = 'Bash'): Record<string, unknown> {
  return { tool_name: toolName, tool_input: { command }, cwd }
}

function tokenPath(cwd: string): string {
  return join(cwd, '.metta', 'scratch', 'skill-session.token')
}

function readToken(cwd: string): TokenFile {
  return JSON.parse(readFileSync(tokenPath(cwd), 'utf8')) as TokenFile
}

function seedToken(cwd: string, token: TokenFile): void {
  mkdirSync(join(cwd, '.metta', 'scratch'), { recursive: true })
  writeFileSync(tokenPath(cwd), JSON.stringify(token), { mode: 0o600 })
}

describe('metta-session-mint hook', { timeout: 30_000 }, () => {
  const tempDirs: string[] = []
  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop()!
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })
  function makeTempCwd(): string {
    const dir = mkdtempSync(join(tmpdir(), 'metta-mint-'))
    tempDirs.push(dir)
    return dir
  }

  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      it('fires and writes a token file with mode 0600 for a valid Bash event', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        expect(existsSync(tokenPath(cwd))).toBe(true)
        const mode = statSync(tokenPath(cwd)).mode & 0o777
        expect(mode).toBe(0o600)
        // Valid JSON
        expect(() => readToken(cwd)).not.toThrow()
      })

      it('mints a payload with exactly the expected keys and values', () => {
        const cwd = makeTempCwd()
        const before = Date.now()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        const after = Date.now()
        expect(code).toBe(0)
        const tok = readToken(cwd)
        expect(Object.keys(tok).sort()).toEqual(
          ['mintedAt', 'skill', 'subcommands', 'token', 'ttlMs'].sort(),
        )
        expect(tok.token).toMatch(V4_UUID_RE)
        expect(tok.skill).toBe('metta-next')
        expect(tok.subcommands).toEqual(['complete', 'finalize'])
        expect(tok.ttlMs).toBe(TTL_MS)
        expect(tok.mintedAt).toBeGreaterThanOrEqual(before)
        expect(tok.mintedAt).toBeLessThanOrEqual(after)
      })

      it('rotates a stale token (mintedAt older than 80% of ttlMs)', () => {
        const cwd = makeTempCwd()
        const staleMintedAt = Date.now() - TTL_MS * 0.9
        const seeded: TokenFile = {
          token: '00000000-0000-4000-8000-000000000000',
          skill: 'metta-next',
          subcommands: ['complete', 'finalize'],
          mintedAt: staleMintedAt,
          ttlMs: TTL_MS,
        }
        seedToken(cwd, seeded)
        const before = Date.now()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        const tok = readToken(cwd)
        expect(tok.token).not.toBe(seeded.token)
        expect(tok.mintedAt).toBeGreaterThanOrEqual(before)
        expect(tok.mintedAt).toBeLessThanOrEqual(Date.now())
      })

      it('does not rotate a fresh token (mintedAt within the last 10% of ttlMs)', () => {
        const cwd = makeTempCwd()
        const seeded: TokenFile = {
          token: '11111111-1111-4111-8111-111111111111',
          skill: 'metta-next',
          subcommands: ['complete', 'finalize'],
          mintedAt: Date.now() - TTL_MS * 0.05,
          ttlMs: TTL_MS,
        }
        seedToken(cwd, seeded)
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        const tok = readToken(cwd)
        expect(tok.token).toBe(seeded.token)
        expect(tok.mintedAt).toBe(seeded.mintedAt)
      })

      describe('scope table: each Tier-2 slug mints its exact subcommand scope', () => {
        for (const [slug, scope] of Object.entries(EXPECTED_SCOPES)) {
          it(`mints subcommands ${JSON.stringify(scope)} for ${slug}`, () => {
            const cwd = makeTempCwd()
            const { code } = runHook(hookPath, slug, bashEvent('metta status --json', cwd), {
              cwd,
            })
            expect(code).toBe(0)
            const tok = readToken(cwd)
            expect(tok.skill).toBe(slug)
            expect(tok.subcommands).toEqual(scope)
          })
        }
      })

      it('unknown slug is a no-op: exit 0, no token file written', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(
          hookPath,
          'metta-unknown-skill',
          bashEvent('metta status --json', cwd),
          { cwd },
        )
        expect(code).toBe(0)
        expect(existsSync(tokenPath(cwd))).toBe(false)
      })

      it('non-Bash tool_name is a no-op: exit 0, no token file written', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(
          hookPath,
          'metta-next',
          bashEvent('irrelevant', cwd, 'Edit'),
          { cwd },
        )
        expect(code).toBe(0)
        expect(existsSync(tokenPath(cwd))).toBe(false)
      })
    })
  }

  it('source and deployed hook are byte-identical', async () => {
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})
