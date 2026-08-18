import { describe, it, expect, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'

// Integration tests for the mint/validate SEAM between the two Tier-2 hooks:
// metta-session-mint.mjs (minting half) and metta-guard-bash.mjs (validating +
// re-priming half). Both hooks run as real subprocesses fed synthetic PreToolUse
// JSON on stdin, exactly as the Claude Code runtime drives them.
//
// Time control (ADR-3): fixture backdating of REAL mint-written token files — the
// hooks carry no clock override, ever (an env-reachable clock knob in a security
// hook is a bypass primitive). Warm-up always uses the real mint hook, never
// hand-modeled tokens (risk R10), so the fixtures can never silently diverge from
// the marker design the hooks actually write.
//
// Race determinism: Claude Code runs all matching PreToolUse hooks in parallel
// with no ordering guarantee, so the mint/guard interleavings are materialized as
// filesystem fixtures (guard-first vs mint-first) rather than real scheduling
// races — the C1/C2 pair pins that the guard's verdict is invariant under hook
// ordering. C3 adds an optional (env-gated, non-load-bearing) concurrent smoke.
//
// Red-first: the bug-pinning cases B1 and C1 were verified RED against the
// pre-fix guard (extracted read-only via `git show <merge-base>`): both exited 2
// with audit reason `credential-expired`. Post-fix they authorize (exit 0), B1
// via the distinct `session-credential-reprimed` audit reason.

const ROOT = join(import.meta.dirname, '..')

// Mint is always paired with the SAME-tier guard copy (never cross-tier): the
// source templates run together and the deployed mirrors run together.
const PAIRS = [
  {
    label: 'source',
    mint: join(ROOT, 'src', 'templates', 'hooks', 'metta-session-mint.mjs'),
    guard: join(ROOT, 'src', 'templates', 'hooks', 'metta-guard-bash.mjs'),
  },
  {
    label: 'deployed',
    mint: join(ROOT, '.claude', 'hooks', 'metta-session-mint.mjs'),
    guard: join(ROOT, '.claude', 'hooks', 'metta-guard-bash.mjs'),
  },
]

const ALL_HOOK_FILES = PAIRS.flatMap((p) => [p.mint, p.guard])

// Constants mirrored from the hooks. RAW_TTL mirrors TTL_MS (mint), GRACE_MS
// mirrors the shared re-prime horizon (both hooks) — drift fails loudly via the
// ADR-4 constant pin below.
const RAW_TTL = 300_000
const GRACE_MS = 3_600_000
// Delegation-window delta: past the raw TTL (fresh band expired) but well inside
// the re-primable horizon — the 15-min post-subagent gap of the incident class.
const DELEGATION = 900_000
// Past every avenue (raw TTL + grace + margin): genuinely dead.
const DEAD = RAW_TTL + GRACE_MS + 60_000

// The single live session id shared by mint warm-ups and guard events — the
// re-prime band only engages when both carry the SAME runtime session id.
const SESSION = 'seam-session-aaaaaaaa'

interface TokenFile {
  token: string
  skill: string
  subcommands: string[]
  mintedAt: number
  ttlMs: number
  sessionId?: string | null
}

// `sessionId: null` omits the field entirely (a runtime that sends none);
// undefined defaults to the shared live SESSION.
function bashEvent(
  command: string,
  cwd: string,
  extra: { sessionId?: string | null } = {},
): Record<string, unknown> {
  const event: Record<string, unknown> = { tool_name: 'Bash', tool_input: { command }, cwd }
  const sessionId = extra.sessionId === undefined ? SESSION : extra.sessionId
  if (sessionId !== null) event.session_id = sessionId
  return event
}

// procCwd (the hook's process cwd) is separated from eventCwd (the event's cwd
// field) so A4 can pin that event.cwd — not the process cwd — drives token-store
// resolution in both hooks.
function runMint(
  mintPath: string,
  slug: string,
  eventCwd: string,
  opts: { procCwd?: string; sessionId?: string | null } = {},
): { code: number; stderr: string } {
  const r = spawnSync('node', [mintPath, slug], {
    input: JSON.stringify(bashEvent('metta status --json', eventCwd, { sessionId: opts.sessionId })),
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.procCwd ?? eventCwd,
  })
  return { code: r.status ?? -1, stderr: r.stderr ?? '' }
}

function runGuard(
  guardPath: string,
  command: string,
  eventCwd: string,
  opts: { procCwd?: string; sessionId?: string | null } = {},
): { code: number; stderr: string } {
  const r = spawnSync('node', [guardPath], {
    input: JSON.stringify(bashEvent(command, eventCwd, { sessionId: opts.sessionId })),
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.procCwd ?? eventCwd,
  })
  return { code: r.status ?? -1, stderr: r.stderr ?? '' }
}

// Async spawn for the C3 concurrency smoke only — everything load-bearing uses
// the deterministic spawnSync fixtures above.
function spawnHook(args: string[], input: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd, stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code ?? -1))
    child.stdin.write(input)
    child.stdin.end()
  })
}

// ADR-3 time control: rewrite the timestamp fields in every real mint-written
// file under the token dir, subtracting deltaMs, plus mtime backdating. All
// marker-layout knowledge funnels through TIMESTAMP_FIELDS (risk R10).
// MUST NOT touch sessionId — the session binding survives backdating.
const TIMESTAMP_FIELDS = ['mintedAt']

function backdate(cwd: string, deltaMs: number): void {
  const dir = join(cwd, '.metta', 'scratch', 'skill-session')
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    try {
      const obj = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
      for (const f of TIMESTAMP_FIELDS) {
        if (Number.isFinite(obj[f])) obj[f] = (obj[f] as number) - deltaMs
      }
      writeFileSync(p, JSON.stringify(obj), { mode: 0o600 })
    } catch {
      // non-JSON marker files: mtime backdating below still applies
    }
    const st = statSync(p)
    utimesSync(p, new Date(st.atimeMs - deltaMs), new Date(st.mtimeMs - deltaMs))
  }
}

function tokenPath(cwd: string, slug: string): string {
  return join(cwd, '.metta', 'scratch', 'skill-session', `${slug}.token`)
}

function readToken(cwd: string, slug: string): TokenFile {
  return JSON.parse(readFileSync(tokenPath(cwd, slug), 'utf8')) as TokenFile
}

function readAuditEntries(cwd: string): Array<Record<string, unknown>> {
  const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('metta-guard/mint seam', { timeout: 60_000 }, () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'metta-seam-'))
    tempDirs.push(dir)
    return dir
  }
  // Mirror the field topology: the change worktree nested under the main
  // checkout at .metta/worktrees/<slug>.
  function makeMainAndWorktree(): { main: string; worktree: string } {
    const main = makeTempCwd()
    const worktree = join(main, '.metta', 'worktrees', 'fix-some-change')
    mkdirSync(worktree, { recursive: true })
    return { main, worktree }
  }

  // ----- ADR-4 constant-drift pin -----
  it('ADR-4: all four hook copies carry the identical GRACE_MS = 3_600_000 literal', () => {
    expect(GRACE_MS).toBe(3_600_000) // the mirrored test constant is part of the pin
    for (const file of ALL_HOOK_FILES) {
      const src = readFileSync(file, 'utf8')
      expect(src, `GRACE_MS literal missing or drifted in ${file}`).toContain(
        'const GRACE_MS = 3_600_000',
      )
    }
  })

  for (const pair of PAIRS) {
    describe(`${pair.label} pair (mint + guard)`, () => {
      // ----- A: regression armor (green pre- and post-fix) -----
      it('A1: fresh-token immediate Tier-2 call from main cwd authorizes (exit 0, session-credential-verified)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        const { code, stderr } = runGuard(pair.guard, 'metta complete research --change c', cwd)
        expect(code).toBe(0)
        expect(stderr).toBe('')
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('allow')
        expect(last.reason).toBe('session-credential-verified')
        expect(last.tier).toBe('session')
      })

      it('A2: fresh-token Tier-2 call with a consistent worktree cwd authorizes (exit 0)', () => {
        const { worktree } = makeMainAndWorktree()
        expect(runMint(pair.mint, 'metta-next', worktree).code).toBe(0)
        const { code, stderr } = runGuard(pair.guard, 'metta complete research --change c', worktree)
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      it('A3: split-cwd sentinel — mint at main, guard at worktree — blocks missing-credential (exit 2)', () => {
        const { main, worktree } = makeMainAndWorktree()
        expect(runMint(pair.mint, 'metta-next', main).code).toBe(0)
        const { code } = runGuard(pair.guard, 'metta complete research --change c', worktree)
        expect(code).toBe(2)
        const entries = readAuditEntries(worktree)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('missing-credential')
        expect(last.tier).toBe('session')
      })

      it('A4: event.cwd (not the hook process cwd) drives token resolution in both hooks (exit 0)', () => {
        const eventCwd = makeTempCwd()
        const procCwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', eventCwd, { procCwd }).code).toBe(0)
        // The token landed under event.cwd, not under the process cwd.
        expect(existsSync(tokenPath(eventCwd, 'metta-next'))).toBe(true)
        expect(existsSync(join(procCwd, '.metta'))).toBe(false)
        const { code, stderr } = runGuard(pair.guard, 'metta complete research --change c', eventCwd, {
          procCwd,
        })
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      // ----- B: bug pin + sliding-refresh sanity -----
      it('B1: delegation-window Tier-2 call re-primes — exit 0, session-credential-reprimed, token rewritten (RED pre-fix)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        backdate(cwd, DELEGATION)
        const before = readToken(cwd, 'metta-next')
        const preCall = Date.now()
        const { code, stderr } = runGuard(pair.guard, 'metta complete implementation', cwd)
        expect(code).toBe(0)
        expect(stderr).toBe('')
        const entries = readAuditEntries(cwd)
        expect(entries.filter((e) => e.reason === 'credential-expired')).toEqual([])
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('allow')
        expect(last.reason).toBe('session-credential-reprimed')
        expect(last.tier).toBe('session')
        expect(typeof last.staleness_ms).toBe('number')
        expect(last.staleness_ms as number).toBeGreaterThanOrEqual(RAW_TTL)
        // The guard rewrote the authorizing token: new random value, mintedAt ~ now,
        // session binding preserved.
        const after = readToken(cwd, 'metta-next')
        expect(after.token).not.toBe(before.token)
        expect(after.mintedAt).toBeGreaterThanOrEqual(preCall)
        expect(after.mintedAt).toBeLessThanOrEqual(Date.now())
        expect(after.sessionId).toBe(SESSION)
        expect(after.subcommands).toEqual(before.subcommands)
      })

      it('B2: sliding refresh — a Bash call past 80% TTL rotates the token on the mint schedule', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        backdate(cwd, RAW_TTL * 0.9)
        const before = readToken(cwd, 'metta-next')
        const preCall = Date.now()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        const after = readToken(cwd, 'metta-next')
        expect(after.token).not.toBe(before.token)
        expect(after.mintedAt).toBeGreaterThanOrEqual(preCall)
        expect(after.mintedAt).toBeLessThanOrEqual(Date.now())
      })

      // ----- C: ordering invariance (materialized interleavings) -----
      it('C1+C2: expired-but-re-primable state yields the identical authorized verdict guard-first and mint-first (C1 RED pre-fix)', () => {
        // C1 — guard-first: the mint refresh has NOT landed; the guard evaluates
        // the backdated state alone. This IS the lost race, materialized.
        const c1 = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', c1).code).toBe(0)
        backdate(c1, DELEGATION)
        const guardFirst = runGuard(pair.guard, 'metta complete implementation', c1)
        expect(guardFirst.code).toBe(0)
        expect(guardFirst.stderr).toBe('')

        // C2 — mint-first: same backdated state, but the mint hook fires first
        // (re-mints, being past 80% of TTL), then the guard evaluates.
        const c2 = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', c2).code).toBe(0)
        backdate(c2, DELEGATION)
        expect(runMint(pair.mint, 'metta-next', c2).code).toBe(0)
        expect(Date.now() - readToken(c2, 'metta-next').mintedAt).toBeLessThan(RAW_TTL)
        const mintFirst = runGuard(pair.guard, 'metta complete implementation', c2)
        expect(mintFirst.code).toBe(0)
        expect(mintFirst.stderr).toBe('')

        // Ordering invariance: identical verdict in both orderings.
        expect(guardFirst.code).toBe(mintFirst.code)
      })

      it.runIf(process.env.METTA_SEAM_STRESS === '1')(
        'C3 (stress smoke, METTA_SEAM_STRESS=1): concurrent mint+guard x25 always authorizes',
        { timeout: 300_000 },
        async () => {
          for (let i = 0; i < 25; i++) {
            const cwd = makeTempCwd()
            expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
            backdate(cwd, DELEGATION)
            const [, guardCode] = await Promise.all([
              spawnHook(
                [pair.mint, 'metta-next'],
                JSON.stringify(bashEvent('metta status --json', cwd)),
                cwd,
              ),
              spawnHook(
                [pair.guard],
                JSON.stringify(bashEvent('metta complete implementation', cwd)),
                cwd,
              ),
            ])
            expect(guardCode, `iteration ${i}`).toBe(0)
          }
        },
      )

      // ----- E: fail-closed armor -----
      it('E1: no mint ever ran — blocks missing-credential with the skill hint in stderr (exit 2)', () => {
        const cwd = makeTempCwd()
        const { code, stderr } = runGuard(pair.guard, 'metta complete intent', cwd)
        expect(code).toBe(2)
        expect(stderr).toContain('/metta-')
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('missing-credential')
        expect(last.tier).toBe('session')
      })

      it('E2: token past TTL + GRACE is genuinely dead — blocks credential-expired even in-session (exit 2)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        backdate(cwd, DEAD)
        const { code } = runGuard(pair.guard, 'metta complete intent', cwd)
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('credential-expired')
        expect(last.tier).toBe('session')
        expect(typeof last.staleness_ms).toBe('number')
        expect(last.staleness_ms as number).toBeGreaterThanOrEqual(RAW_TTL + GRACE_MS)
      })

      it('E3: fresh token out of scope — mint metta-refresh, call metta complete — blocks subcommand-not-in-scope (exit 2)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-refresh', cwd).code).toBe(0)
        const { code } = runGuard(pair.guard, 'metta complete intent', cwd)
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('subcommand-not-in-scope')
        expect(last.tier).toBe('session')
      })

      it('E4: a well-formed credential at the retired single-file path is ignored — missing-credential (exit 2)', () => {
        const cwd = makeTempCwd()
        mkdirSync(join(cwd, '.metta', 'scratch'), { recursive: true })
        writeFileSync(
          join(cwd, '.metta', 'scratch', 'skill-session.token'),
          JSON.stringify({
            token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            skill: 'metta-next',
            subcommands: ['complete', 'finalize'],
            mintedAt: Date.now(),
            ttlMs: RAW_TTL,
            sessionId: SESSION,
          }),
          { mode: 0o600 },
        )
        const { code } = runGuard(pair.guard, 'metta complete intent', cwd)
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('missing-credential')
        expect(last.tier).toBe('session')
      })

      it('E5: a hand-fabricated token (orchestrator-authored, wrong shape, no mint) fails closed (exit 2)', () => {
        const cwd = makeTempCwd()
        mkdirSync(join(cwd, '.metta', 'scratch', 'skill-session'), { recursive: true })
        // Everything an orchestrator could author from reading skill files —
        // but structurally invalid (no `token` value): validateToken rejects it,
        // so the guard sees no credential at all.
        writeFileSync(
          tokenPath(cwd, 'metta-next'),
          JSON.stringify({
            skill: 'metta-next',
            subcommands: ['complete', 'finalize'],
            mintedAt: Date.now(),
            ttlMs: RAW_TTL,
            sessionId: SESSION,
          }),
          { mode: 0o600 },
        )
        const { code } = runGuard(pair.guard, 'metta complete intent', cwd)
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('missing-credential')
        expect(last.tier).toBe('session')
      })

      it('E6: session binding — token minted under session A, event carries B — expired token stays dead (exit 2)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd, { sessionId: 'seam-session-A' }).code).toBe(0)
        backdate(cwd, DELEGATION)
        const { code } = runGuard(pair.guard, 'metta complete implementation', cwd, {
          sessionId: 'seam-session-B',
        })
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('credential-expired')
        expect(last.tier).toBe('session')
      })

      it('E7: degradation — guard event carries no session_id — re-prime disabled, exact pre-fix block (exit 2)', () => {
        const cwd = makeTempCwd()
        expect(runMint(pair.mint, 'metta-next', cwd).code).toBe(0)
        backdate(cwd, DELEGATION)
        const { code } = runGuard(pair.guard, 'metta complete implementation', cwd, {
          sessionId: null,
        })
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        const last = entries[entries.length - 1]
        expect(last.verdict).toBe('block')
        expect(last.reason).toBe('credential-expired')
        expect(last.tier).toBe('session')
      })
    })
  }
})
