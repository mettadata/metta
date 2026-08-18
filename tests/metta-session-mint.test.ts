import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-session-mint PreToolUse hook tests: the Tier-2 credential-minting half
// of the two-tier trust model (metta-guard-bash.mjs is the validating half).
// Each skill's hook mints its OWN token file at
// .metta/scratch/skill-session/<slug>.token — hooks accumulated from previously
// invoked skills never clobber or suppress the active skill's credential.
// The source template and the deployed mirror must stay byte-identical; tests
// run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-session-mint.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-session-mint.mjs'),
]

const TTL_MS = 300000
// Mirrors GRACE_MS in metta-session-mint.mjs (and metta-guard-bash.mjs): siblings
// within ttlMs + GRACE_MS are still re-primable by the guard and must be KEPT.
const GRACE_MS = 3_600_000

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
  'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote', 'backlog:migrate', 'milestone:create'],
  'metta-fix-gap': ['fix-gap', 'complete', 'finalize'],
}

const V4_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface TokenFile {
  token: string
  skill: string
  subcommands: string[]
  mintedAt: number
  ttlMs: number
  sessionId?: string | null
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

function bashEvent(
  command: string,
  cwd: string,
  toolName = 'Bash',
  sessionId?: string,
): Record<string, unknown> {
  const event: Record<string, unknown> = { tool_name: toolName, tool_input: { command }, cwd }
  if (sessionId !== undefined) event.session_id = sessionId
  return event
}

function tokenDir(cwd: string): string {
  return join(cwd, '.metta', 'scratch', 'skill-session')
}

function tokenPath(cwd: string, slug: string): string {
  return join(tokenDir(cwd), `${slug}.token`)
}

function legacyTokenPath(cwd: string): string {
  return join(cwd, '.metta', 'scratch', 'skill-session.token')
}

function readToken(cwd: string, slug: string): TokenFile {
  return JSON.parse(readFileSync(tokenPath(cwd, slug), 'utf8')) as TokenFile
}

function seedToken(cwd: string, token: TokenFile): void {
  mkdirSync(tokenDir(cwd), { recursive: true })
  writeFileSync(tokenPath(cwd, token.skill), JSON.stringify(token), { mode: 0o600 })
}

describe('metta-session-mint hook', { timeout: 30_000 }, () => {
  const tempDirs: string[] = []
  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop()!
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
      it('fires and writes a per-skill token file with mode 0600 for a valid Bash event', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        expect(existsSync(tokenPath(cwd, 'metta-next'))).toBe(true)
        const mode = statSync(tokenPath(cwd, 'metta-next')).mode & 0o777
        expect(mode).toBe(0o600)
        // Valid JSON
        expect(() => readToken(cwd, 'metta-next')).not.toThrow()
        // The retired single-file credential path is never written.
        expect(existsSync(legacyTokenPath(cwd))).toBe(false)
      })

      it('mints a payload with exactly the expected keys and values', () => {
        const cwd = makeTempCwd()
        const sessionId = 'sess-mint-payload-test'
        const before = Date.now()
        const { code } = runHook(
          hookPath,
          'metta-next',
          bashEvent('metta status --json', cwd, 'Bash', sessionId),
          { cwd },
        )
        const after = Date.now()
        expect(code).toBe(0)
        const tok = readToken(cwd, 'metta-next')
        expect(Object.keys(tok).sort()).toEqual(
          ['mintedAt', 'sessionId', 'skill', 'subcommands', 'token', 'ttlMs'].sort(),
        )
        expect(tok.token).toMatch(V4_UUID_RE)
        expect(tok.skill).toBe('metta-next')
        expect(tok.subcommands).toEqual(['complete', 'finalize'])
        expect(tok.ttlMs).toBe(TTL_MS)
        expect(tok.sessionId).toBe(sessionId)
        expect(tok.mintedAt).toBeGreaterThanOrEqual(before)
        expect(tok.mintedAt).toBeLessThanOrEqual(after)
      })

      it('stamps sessionId as null when the event omits session_id', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        const tok = readToken(cwd, 'metta-next')
        expect(tok.sessionId).toBeNull()
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
        const tok = readToken(cwd, 'metta-next')
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
        const tok = readToken(cwd, 'metta-next')
        expect(tok.token).toBe(seeded.token)
        expect(tok.mintedAt).toBe(seeded.mintedAt)
      })

      // Regression (session-mint token clobbering after context compaction): a fresh
      // token minted by a previously invoked skill's accumulated hook must neither
      // suppress this skill's mint nor be overwritten by it.
      it('two skills minting concurrently do not clobber each other', () => {
        const cwd = makeTempCwd()
        const first = runHook(hookPath, 'metta-refresh', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(first.code).toBe(0)
        const refreshTok = readToken(cwd, 'metta-refresh')

        const second = runHook(hookPath, 'metta-verify', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(second.code).toBe(0)

        // Both per-skill tokens coexist, each with its own scope.
        const verifyTok = readToken(cwd, 'metta-verify')
        expect(verifyTok.skill).toBe('metta-verify')
        expect(verifyTok.subcommands).toEqual(['verify', 'complete'])
        const refreshTokAfter = readToken(cwd, 'metta-refresh')
        expect(refreshTokAfter.skill).toBe('metta-refresh')
        expect(refreshTokAfter.subcommands).toEqual(['refresh'])
        // The first skill's fresh token was left untouched (not rotated or overwritten).
        expect(refreshTokAfter.token).toBe(refreshTok.token)
        expect(refreshTokAfter.mintedAt).toBe(refreshTok.mintedAt)
      })

      it("another skill's fresh token does not suppress this skill's own mint", () => {
        const cwd = makeTempCwd()
        // A fresh token for a different skill is already present (previously invoked
        // skill's hook fired first at this rotation window).
        seedToken(cwd, {
          token: '22222222-2222-4222-8222-222222222222',
          skill: 'metta-refresh',
          subcommands: ['refresh'],
          mintedAt: Date.now(),
          ttlMs: TTL_MS,
        })
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        // metta-next minted its own token despite the fresh metta-refresh token.
        const tok = readToken(cwd, 'metta-next')
        expect(tok.skill).toBe('metta-next')
        expect(tok.subcommands).toEqual(['complete', 'finalize'])
      })

      it('deletes genuinely dead sibling token files on mint, keeps fresh and re-primable ones', () => {
        const cwd = makeTempCwd()
        seedToken(cwd, {
          token: '33333333-3333-4333-8333-333333333333',
          skill: 'metta-refresh',
          subcommands: ['refresh'],
          mintedAt: Date.now() - TTL_MS - GRACE_MS - 60_000, // past ttlMs + GRACE_MS: dead
          ttlMs: TTL_MS,
        })
        seedToken(cwd, {
          token: '44444444-4444-4444-8444-444444444444',
          skill: 'metta-verify',
          subcommands: ['verify', 'complete'],
          mintedAt: Date.now(), // fresh
          ttlMs: TTL_MS,
        })
        seedToken(cwd, {
          token: '66666666-6666-4666-8666-666666666666',
          skill: 'metta-plan',
          subcommands: ['complete'],
          mintedAt: Date.now() - TTL_MS - 60_000, // between ttlMs and ttlMs + GRACE_MS: re-primable
          ttlMs: TTL_MS,
        })
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        expect(existsSync(tokenPath(cwd, 'metta-refresh'))).toBe(false) // dead sibling removed
        expect(existsSync(tokenPath(cwd, 'metta-verify'))).toBe(true) // fresh sibling kept
        // Sibling inside the guard's re-prime horizon is KEPT (previously deleted):
        // cleanup must never starve a token the guard would still re-prime.
        expect(existsSync(tokenPath(cwd, 'metta-plan'))).toBe(true)
        expect(existsSync(tokenPath(cwd, 'metta-next'))).toBe(true) // own token minted
      })

      it('atomic write: mint leaves no *.tmp residue and the token parses as JSON', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        const names = readdirSync(tokenDir(cwd))
        expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
        expect(() => readToken(cwd, 'metta-next')).not.toThrow()
      })

      it('removes a lingering legacy single-file token on mint', () => {
        const cwd = makeTempCwd()
        mkdirSync(join(cwd, '.metta', 'scratch'), { recursive: true })
        writeFileSync(
          legacyTokenPath(cwd),
          JSON.stringify({
            token: '55555555-5555-4555-8555-555555555555',
            skill: 'metta-refresh',
            subcommands: ['refresh'],
            mintedAt: Date.now(),
            ttlMs: TTL_MS,
          }),
          { mode: 0o600 },
        )
        const { code } = runHook(hookPath, 'metta-next', bashEvent('metta status --json', cwd), {
          cwd,
        })
        expect(code).toBe(0)
        expect(existsSync(legacyTokenPath(cwd))).toBe(false)
        expect(existsSync(tokenPath(cwd, 'metta-next'))).toBe(true)
      })

      describe('scope table: each Tier-2 slug mints its exact subcommand scope', () => {
        for (const [slug, scope] of Object.entries(EXPECTED_SCOPES)) {
          it(`mints subcommands ${JSON.stringify(scope)} for ${slug}`, () => {
            const cwd = makeTempCwd()
            const { code } = runHook(hookPath, slug, bashEvent('metta status --json', cwd), {
              cwd,
            })
            expect(code).toBe(0)
            const tok = readToken(cwd, slug)
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
        expect(existsSync(tokenDir(cwd))).toBe(false)
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
        expect(existsSync(tokenDir(cwd))).toBe(false)
      })
    })
  }

  it('source and deployed hook are byte-identical', async () => {
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})
