import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-guard-bash PreToolUse hook integration tests.
// The source template and the deployed mirror must stay byte-identical; tests
// run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-bash.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-guard-bash.mjs'),
]

// Shared sandbox cwd for hook invocations that do not explicitly opt into their
// own tempDir. Since Task 3.1 added an audit log written to
// <cwd>/.metta/logs/guard-bypass.log, every test run that inherits the repo
// cwd would pollute the real working tree. Default all runHook calls to this
// throwaway dir and nuke it after the file finishes.
const SHARED_SANDBOX = mkdtempSync(join(tmpdir(), 'metta-guard-shared-'))
afterAll(() => {
  try {
    rmSync(SHARED_SANDBOX, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // best-effort
  }
})

function runHook(
  hookPath: string,
  payload: unknown,
  opts: { env?: NodeJS.ProcessEnv; rawStdin?: string; cwd?: string } = {},
): { code: number; stderr: string } {
  const env = { ...process.env, ...(opts.env ?? {}) }
  // The retired METTA_SKILL env bypass is ignored by the hook; strip any inherited value
  // anyway so tests only see it when they explicitly opt in (to prove it is inert).
  if (!('METTA_SKILL' in (opts.env ?? {}))) {
    delete env.METTA_SKILL
  }
  const input = opts.rawStdin !== undefined ? opts.rawStdin : JSON.stringify(payload)
  const result = spawnSync('node', [hookPath], {
    input,
    env,
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.cwd ?? SHARED_SANDBOX,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

function bashEvent(
  command: string,
  extra: { agent_type?: string; cwd?: string; run_in_background?: boolean } = {},
): Record<string, unknown> {
  const toolInput: Record<string, unknown> = { command }
  if (extra.run_in_background !== undefined) toolInput.run_in_background = extra.run_in_background
  const event: Record<string, unknown> = { tool_name: 'Bash', tool_input: toolInput }
  if (extra.agent_type !== undefined) event.agent_type = extra.agent_type
  if (extra.cwd !== undefined) event.cwd = extra.cwd
  return event
}

describe('metta-guard-bash hook', { timeout: 30_000 }, () => {
  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      // ----- Blocked cases (explicit BLOCK list) -----
      it('blocks `metta propose "foo"` without env (exit 2, stderr mentions /metta-)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta propose "foo"'))
        expect(code).toBe(2)
        expect(stderr).toContain('/metta-')
        expect(stderr).toContain('metta propose')
      })

      it('blocks `metta quick "foo"` without env (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta quick "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta issue "foo"` without env (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta issue "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta complete intent` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta complete intent'))
        expect(code).toBe(2)
      })

      it('blocks `metta backlog add "foo"` two-word (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog add "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta changes abandon` two-word (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta changes abandon'))
        expect(code).toBe(2)
      })

      // ----- Unknown subcommands (conservative-block) -----
      it('blocks unknown single-word `metta unknowncmd` conservatively (exit 2)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta unknowncmd'))
        expect(code).toBe(2)
        expect(stderr).toContain('unknown metta subcommand')
        expect(stderr).toContain('unknowncmd')
      })

      it('blocks unknown two-word `metta unknown foo` conservatively (exit 2)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta unknown foo'))
        expect(code).toBe(2)
        expect(stderr).toContain('unknown metta subcommand')
      })

      // ----- Allowed cases (explicit ALLOW list) -----
      it('allows `metta status` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta status'))
        expect(code).toBe(0)
      })

      it('allows `metta instructions intent --change foo` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta instructions intent --change foo'))
        expect(code).toBe(0)
      })

      it('allows `metta issues list` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta issues list'))
        expect(code).toBe(0)
      })

      it('allows `metta gate list` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta gate list'))
        expect(code).toBe(0)
      })

      it('allows `metta progress` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta progress'))
        expect(code).toBe(0)
      })

      it('allows `metta changes list` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta changes list'))
        expect(code).toBe(0)
      })

      it('allows `metta doctor` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta doctor'))
        expect(code).toBe(0)
      })

      it('allows `metta install` (explicit pass-through, no matching skill) (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta install'))
        expect(code).toBe(0)
      })

      it('allows `metta backlog list` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog list'))
        expect(code).toBe(0)
      })

      it('allows `metta backlog show foo` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog show foo'))
        expect(code).toBe(0)
      })

      it('allows `metta gaps list` two-word without any credential (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta gaps list'))
        expect(code).toBe(0)
      })

      it('allows `metta gaps show foo` two-word without any credential (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta gaps show foo'))
        expect(code).toBe(0)
      })

      it('blocks `metta gaps remove foo` (unlisted, mutating — stays fail-closed) (exit 2)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta gaps remove foo'))
        expect(code).toBe(2)
        expect(stderr).toContain('unknown metta subcommand')
      })

      it('blocks `metta verify --json` without any credential — Tier-2 missing-credential (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta verify --json'))
        expect(code).toBe(2)
      })

      it('allows `metta verify --json` with a valid metta-verify-scoped session token (exit 0)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'metta-guard-verify-'))
        try {
          mkdirSync(join(dir, '.metta', 'scratch', 'skill-session'), { recursive: true })
          const tok = {
            token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            skill: 'metta-verify',
            subcommands: ['verify', 'complete'],
            mintedAt: Date.now(),
            ttlMs: 300000,
          }
          writeFileSync(
            join(dir, '.metta', 'scratch', 'skill-session', 'metta-verify.token'),
            JSON.stringify(tok),
            { mode: 0o600 },
          )
          const { code, stderr } = runHook(hookPath, bashEvent('metta verify --json', { cwd: dir }), {
            cwd: dir,
          })
          expect(code).toBe(0)
          expect(stderr).toBe('')
        } finally {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        }
      })

      it('allows `metta next --json` (read-only routing query, metta-next skill first call) (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta next --json'))
        expect(code).toBe(0)
      })

      it('allows `metta model-escalation record ...` with no agent_type (orchestrator-driven, non-forked) (exit 0)', () => {
        const { code, stderr } = runHook(
          hookPath,
          bashEvent(
            'metta model-escalation record --task x --from sonnet --to inherit --trigger stop_deviation',
          ),
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      it('allows `metta tokens record ...` with no agent_type (orchestrator-driven, non-forked) (exit 0)', () => {
        const { code, stderr } = runHook(
          hookPath,
          bashEvent(
            'metta tokens record --task impl --agent executor --model haiku --tokens 1000',
          ),
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      // ----- Retired legacy bypass / env prefixes / chains -----
      it('ignores METTA_SKILL=1 env on the hook process — `metta propose "foo"` still blocked (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta propose "foo"'), {
          env: { METTA_SKILL: '1' },
        })
        expect(code).toBe(2)
      })

      it('allows bare `metta propose "foo"` from a trusted fork caller — agent identity alone (exit 0)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('metta propose "foo"', { agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
      })

      it('consumes multiple env prefixes: `FOO=bar BAZ=qux metta propose` + trusted agent_type (exit 0)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('FOO=bar BAZ=qux metta propose', { agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
      })

      it('rejects inline prefix on two-word `METTA_SKILL=1 metta backlog add "foo"` — prefix credits nothing (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta backlog add "foo"'))
        expect(code).toBe(2)
      })

      it('chain with allowed and blocked invocations still blocks — inline prefix credits nothing (exit 2)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('METTA_SKILL=1 metta status && metta propose "foo"'),
        )
        expect(code).toBe(2)
      })

      it('detects metta after non-bypass env prefix `FOO=bar metta propose "foo"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('FOO=bar metta propose "foo"'))
        expect(code).toBe(2)
      })

      it('scans chain `cd /foo && metta issue "bar"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('cd /foo && metta issue "bar"'))
        expect(code).toBe(2)
      })

      // ----- Quote-aware tokenization: free-text args must not trigger phantom invocations -----
      it('allows `metta status "see metta finalize docs"`: quoted arg text is not a phantom invocation (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta status "see metta finalize docs"'))
        expect(code).toBe(0)
      })

      it('still blocks a genuine chained `metta status && metta finalize` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta status && metta finalize'))
        expect(code).toBe(2)
      })

      // ----- Skill-enforced caller-identity enforcement + audit log -----
      describe('skill-enforced caller-identity enforcement', () => {
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
          const dir = mkdtempSync(join(tmpdir(), 'metta-guard-'))
          tempDirs.push(dir)
          return dir
        }

        // (a) Enforced subcommand + legacy inline prefix + NO agent_type -> block (prefix credits nothing)
        it('blocks enforced subcommand with inline METTA_SKILL=1 but no agent_type (exit 2)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"'),
          )
          expect(code).toBe(2)
          expect(stderr).toContain('/metta-issue')
          expect(stderr).toContain('Inline command text never authorizes skill-enforced subcommands')
        })

        // (b) Bare enforced subcommand + agent_type='metta-skill-host' -> allow (agent identity alone)
        it('allows bare enforced subcommand with agent_type=metta-skill-host alone (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('metta issue "hello"', { agent_type: 'metta-skill-host' }),
          )
          expect(code).toBe(0)
        })

        // (b2) Tier-1 agent-identity-only accept for ship
        it('allows bare `metta ship --change x` with agent_type=metta-skill-host (exit 0)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('metta ship --change x', { agent_type: 'metta-skill-host' }),
          )
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        // (c) Bare enforced subcommand + agent_type='metta-issue' -> allow
        it('allows bare enforced subcommand with any metta-* agent_type prefix (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('metta issue "hello"', { agent_type: 'metta-issue' }),
          )
          expect(code).toBe(0)
        })

        // (d) Bare enforced subcommand + agent_type='other-agent' -> block
        it('blocks bare enforced subcommand with non-metta agent_type (exit 2)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('metta issue "hello"', { agent_type: 'other-agent' }),
          )
          expect(code).toBe(2)
        })

        // (e) Enforced subcommand + NO METTA_SKILL=1 + NO agent_type -> block with unified skill-enforced message
        it('blocks bare enforced subcommand with unified skill-enforced message (exit 2)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta issue "foo"'))
          expect(code).toBe(2)
          // Per spec R1: ANY block of an enforced subcommand emits the unified advisory,
          // even when no inline bypass was attempted.
          expect(stderr).toContain('/metta-issue')
          expect(stderr).toContain(
            'Inline command text never authorizes skill-enforced subcommands',
          )
        })

        // (f) Non-enforced subcommand + legacy inline prefix + NO agent_type, no token -> block
        it('blocks non-enforced subcommand with inline METTA_SKILL=1, no agent_type, no token (exit 2)', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh', { cwd }), {
            cwd,
          })
          expect(code).toBe(2)
        })

        // (g) Allowed subcommand -> exit 0 and no audit log created
        it('does not create an audit log entry for an allowed subcommand', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('metta status'), { cwd })
          expect(code).toBe(0)
          expect(existsSync(join(cwd, '.metta', 'logs', 'guard-bypass.log'))).toBe(false)
        })

        // (h) Audit log written on enforced block
        it('writes a JSON audit log entry when an enforced block fires', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"', { cwd }),
            { cwd },
          )
          expect(code).toBe(2)
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          expect(existsSync(logPath)).toBe(true)
          const raw = readFileSync(logPath, 'utf8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          expect(lines.length).toBe(1)
          const entry = JSON.parse(lines[0])
          expect(entry.verdict).toBe('block')
          expect(entry.subcommand).toBe('issue')
          expect(entry.agent_type).toBe(null)
          expect(typeof entry.reason).toBe('string')
          expect(Array.isArray(entry.event_keys)).toBe(true)
          expect(entry.event_keys.length).toBeGreaterThan(0)
          expect(typeof entry.ts).toBe('string')
          // ISO 8601 date string roundtrip
          const parsed = new Date(entry.ts)
          expect(Number.isNaN(parsed.getTime())).toBe(false)
          expect(parsed.toISOString()).toBe(entry.ts)
        })

        // (i) Legacy allow_with_bypass is fully retired: the inline prefix on a non-enforced
        // subcommand is blocked as missing-credential and audit-logged on the session tier.
        it('logs a session-tier block (not allow_with_bypass) for a non-enforced inline-prefix attempt', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh', { cwd }), {
            cwd,
          })
          expect(code).toBe(2)
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          expect(existsSync(logPath)).toBe(true)
          const raw = readFileSync(logPath, 'utf8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          expect(lines.length).toBe(1)
          const entry = JSON.parse(lines[0])
          expect(entry.verdict).toBe('block')
          expect(entry.subcommand).toBe('refresh')
          expect(entry.reason).toBe('missing-credential')
          expect(entry.tier).toBe('session')
        })
      })

      // ----- Background Bash rejection from forked metta agents -----
      describe('background Bash rejection from forked metta agents', () => {
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
          const dir = mkdtempSync(join(tmpdir(), 'metta-guard-bg-'))
          tempDirs.push(dir)
          return dir
        }

        // (1) Background Bash from metta-skill-host -> block, regardless of command
        it('blocks run_in_background from agent_type=metta-skill-host (exit 2)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('sleep 100', { agent_type: 'metta-skill-host', run_in_background: true }),
          )
          expect(code).toBe(2)
          expect(stderr).toContain('Blocked Bash run_in_background')
          expect(stderr).toContain('metta-skill-host')
        })

        // (2a) Same background command with NO agent_type -> allowed (caller-scoped block)
        it('allows run_in_background when agent_type is absent (exit 0)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('sleep 100', { run_in_background: true }),
          )
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        // (2b) Same background command from a non-metta agent -> allowed
        it('allows run_in_background from a non-metta agent_type (exit 0)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('sleep 100', { agent_type: 'orchestrator', run_in_background: true }),
          )
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        // (3) Any metta-* prefixed agent is covered, not just metta-skill-host
        it('blocks run_in_background from any metta-* agent (metta-executor) (exit 2)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('sleep 100', { agent_type: 'metta-executor', run_in_background: true }),
          )
          expect(code).toBe(2)
          expect(stderr).toContain('Blocked Bash run_in_background')
          expect(stderr).toContain('metta-executor')
        })

        // (4a) Non-background Bash from a trusted metta agent -> existing classify pipeline
        // is unchanged (enforced subcommand + trusted caller identity still allows).
        it('leaves foreground classify behavior unchanged for trusted agents (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('metta issue "hello"', { agent_type: 'metta-skill-host' }),
          )
          expect(code).toBe(0)
        })

        // (4b) run_in_background: false is not a background call — same as absent.
        it('leaves classify behavior unchanged when run_in_background is false (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('metta issue "hello"', {
              agent_type: 'metta-skill-host',
              run_in_background: false,
            }),
          )
          expect(code).toBe(0)
        })

        // Audit trail: the block writes a JSON entry with reason background-bash-from-fork.
        it('writes an audit log entry with reason background-bash-from-fork on block', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(
            hookPath,
            bashEvent('sleep 100', {
              agent_type: 'metta-skill-host',
              run_in_background: true,
              cwd,
            }),
            { cwd },
          )
          expect(code).toBe(2)
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          expect(existsSync(logPath)).toBe(true)
          const lines = readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((l) => l.length > 0)
          expect(lines.length).toBe(1)
          const entry = JSON.parse(lines[0])
          expect(entry.verdict).toBe('block')
          expect(entry.reason).toBe('background-bash-from-fork')
          expect(entry.agent_type).toBe('metta-skill-host')
          expect(entry.subcommand).toBe(null)
        })
      })

      // ----- Tier-2 session-credential validation (skill-session token) -----
      describe('Tier-2 session-credential validation', () => {
        const TTL_MS = 300_000
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
          const dir = mkdtempSync(join(tmpdir(), 'metta-guard-tier2-'))
          tempDirs.push(dir)
          return dir
        }
        // Per-skill token files: each seeded token lands at
        // .metta/scratch/skill-session/<skill>.token, mirroring the mint hook.
        function seedToken(
          cwd: string,
          overrides: Partial<{
            token: string
            skill: string
            subcommands: string[]
            mintedAt: number
            ttlMs: number
          }> = {},
        ): void {
          mkdirSync(join(cwd, '.metta', 'scratch', 'skill-session'), { recursive: true })
          const tok = {
            token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            skill: 'metta-next',
            subcommands: ['complete', 'finalize'],
            mintedAt: Date.now(),
            ttlMs: TTL_MS,
            ...overrides,
          }
          writeFileSync(
            join(cwd, '.metta', 'scratch', 'skill-session', `${tok.skill}.token`),
            JSON.stringify(tok),
            { mode: 0o600 },
          )
        }
        function readAuditEntries(cwd: string): Array<Record<string, unknown>> {
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          return readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((l) => l.length > 0)
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        }

        it('allows a Tier-2 subcommand with a fresh, in-scope token (exit 0)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd)
          const { code, stderr } = runHook(hookPath, bashEvent('metta complete intent', { cwd }), {
            cwd,
          })
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('logs every session-tier acceptance (tier=session, reason=session-credential-verified)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd)
          const { code } = runHook(hookPath, bashEvent('metta complete intent', { cwd }), { cwd })
          expect(code).toBe(0)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.tier).toBe('session')
          expect(last.reason).toBe('session-credential-verified')
          expect(last.verdict).toBe('allow')
          expect(last.subcommand).toBe('complete')
        })

        it('blocks with an expired token — audit reason credential-expired, tier session (exit 2)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd, { mintedAt: Date.now() - TTL_MS - 1000 })
          const { code, stderr } = runHook(hookPath, bashEvent('metta complete intent', { cwd }), {
            cwd,
          })
          expect(code).toBe(2)
          // The rejection must not credit the (expired) token as authorization.
          expect(stderr).not.toContain('session-credential-verified')
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('credential-expired')
          expect(last.tier).toBe('session')
        })

        it('blocks with no token file at all — audit reason missing-credential, tier session (exit 2)', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('metta complete intent', { cwd }), { cwd })
          expect(code).toBe(2)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('missing-credential')
          expect(last.tier).toBe('session')
        })

        it('blocks an out-of-scope subcommand — token minted for metta-refresh cannot call finalize (exit 2)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd, { skill: 'metta-refresh', subcommands: ['refresh'] })
          const { code } = runHook(hookPath, bashEvent('metta finalize', { cwd }), { cwd })
          expect(code).toBe(2)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('subcommand-not-in-scope')
          expect(last.tier).toBe('session')
        })

        // Regression (session-mint token clobbering): a fresh token minted earlier by a
        // DIFFERENT skill must not block the active skill whose own token is also present.
        it('authorizes via the active skill token even when an older different-skill fresh token coexists (exit 0)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd, {
            token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            skill: 'metta-refresh',
            subcommands: ['refresh'],
            mintedAt: Date.now() - 60_000, // older but still fresh
          })
          seedToken(cwd, { skill: 'metta-next', subcommands: ['complete', 'finalize'] })
          const { code, stderr } = runHook(hookPath, bashEvent('metta finalize', { cwd }), { cwd })
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('denies a subcommand covered by no unexpired token — expired in-scope token does not authorize (exit 2)', () => {
          const cwd = makeTempCwd()
          // In-scope token for finalize is expired…
          seedToken(cwd, {
            skill: 'metta-next',
            subcommands: ['complete', 'finalize'],
            mintedAt: Date.now() - TTL_MS - 1000,
          })
          // …and the only fresh token does not cover finalize.
          seedToken(cwd, { skill: 'metta-refresh', subcommands: ['refresh'] })
          const { code } = runHook(hookPath, bashEvent('metta finalize', { cwd }), { cwd })
          expect(code).toBe(2)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('subcommand-not-in-scope')
          expect(last.tier).toBe('session')
        })

        it('blocks when every token file in the directory is expired — reason credential-expired (exit 2)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd, {
            skill: 'metta-next',
            subcommands: ['complete', 'finalize'],
            mintedAt: Date.now() - TTL_MS - 1000,
          })
          seedToken(cwd, {
            skill: 'metta-refresh',
            subcommands: ['refresh'],
            mintedAt: Date.now() - TTL_MS - 5000,
          })
          const { code } = runHook(hookPath, bashEvent('metta finalize', { cwd }), { cwd })
          expect(code).toBe(2)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('credential-expired')
          expect(last.tier).toBe('session')
        })

        // Clean cutover: the retired single-file credential is not honored.
        it('ignores a legacy .metta/scratch/skill-session.token single-file credential — missing-credential (exit 2)', () => {
          const cwd = makeTempCwd()
          mkdirSync(join(cwd, '.metta', 'scratch'), { recursive: true })
          writeFileSync(
            join(cwd, '.metta', 'scratch', 'skill-session.token'),
            JSON.stringify({
              token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              skill: 'metta-next',
              subcommands: ['complete', 'finalize'],
              mintedAt: Date.now(),
              ttlMs: TTL_MS,
            }),
            { mode: 0o600 },
          )
          const { code } = runHook(hookPath, bashEvent('metta finalize', { cwd }), { cwd })
          expect(code).toBe(2)
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('missing-credential')
          expect(last.tier).toBe('session')
        })

        it('scopes two-word forms via "<sub>:<third>" keys — backlog:add token allows metta backlog add (exit 0)', () => {
          const cwd = makeTempCwd()
          seedToken(cwd, {
            skill: 'metta-backlog',
            subcommands: ['backlog:add', 'backlog:done', 'backlog:promote'],
          })
          const { code } = runHook(hookPath, bashEvent('metta backlog add "foo"', { cwd }), { cwd })
          expect(code).toBe(0)
        })

        it('accepts a fork body calling a Tier-2 sub without any token (trusted agent_type) (exit 0)', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(
            hookPath,
            bashEvent('metta finalize', { agent_type: 'metta-skill-host', cwd }),
            { cwd },
          )
          expect(code).toBe(0)
        })

        // Legacy branch deleted (task 4.1): the inline METTA_SKILL=1 prefix credits nothing.
        // With no token and no trusted agent_type the call falls through to the token check
        // and is rejected as missing-credential.
        it('rejects legacy inline METTA_SKILL=1 metta finalize — no token, no agent_type (exit 2)', () => {
          const cwd = makeTempCwd()
          const { code, stderr } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta finalize', { cwd }), {
            cwd,
          })
          expect(code).toBe(2)
          expect(stderr).not.toContain('session-credential-verified')
          const entries = readAuditEntries(cwd)
          const last = entries[entries.length - 1]
          expect(last.verdict).toBe('block')
          expect(last.reason).toBe('missing-credential')
          expect(last.tier).toBe('session')
        })
      })

      // ----- Release classification (read-only status vs Tier-2 cut) -----
      describe('release classification', () => {
        const TTL_MS = 300_000
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
          const dir = mkdtempSync(join(tmpdir(), 'metta-guard-release-'))
          tempDirs.push(dir)
          return dir
        }

        it('allows `metta release status` two-word without any credential (exit 0)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta release status'))
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('allows bare `metta release` (read-only status view) without any credential (exit 0)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta release'))
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('allows `metta release --json` without any credential (exit 0)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta release --json'))
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('blocks `metta release cut` without a session credential — Tier-2 missing-credential (exit 2)', () => {
          const cwd = makeTempCwd()
          const { code, stderr } = runHook(hookPath, bashEvent('metta release cut', { cwd }), {
            cwd,
          })
          expect(code).toBe(2)
          expect(stderr).toContain('/metta-')
        })

        it('allows `metta release cut` with a valid release:cut-scoped session token (exit 0)', () => {
          const cwd = makeTempCwd()
          mkdirSync(join(cwd, '.metta', 'scratch', 'skill-session'), { recursive: true })
          const tok = {
            token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            skill: 'metta-release',
            subcommands: ['release:cut'],
            mintedAt: Date.now(),
            ttlMs: TTL_MS,
          }
          writeFileSync(
            join(cwd, '.metta', 'scratch', 'skill-session', 'metta-release.token'),
            JSON.stringify(tok),
            { mode: 0o600 },
          )
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('metta release cut --bump minor --yes --json', { cwd }),
            { cwd },
          )
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('blocks `metta release cut` when the token scope does not include release:cut (exit 2)', () => {
          const cwd = makeTempCwd()
          mkdirSync(join(cwd, '.metta', 'scratch', 'skill-session'), { recursive: true })
          const tok = {
            token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            skill: 'metta-backlog',
            subcommands: ['backlog:add', 'backlog:done', 'backlog:promote'],
            mintedAt: Date.now(),
            ttlMs: TTL_MS,
          }
          writeFileSync(
            join(cwd, '.metta', 'scratch', 'skill-session', 'metta-backlog.token'),
            JSON.stringify(tok),
            { mode: 0o600 },
          )
          const { code } = runHook(hookPath, bashEvent('metta release cut', { cwd }), { cwd })
          expect(code).toBe(2)
        })

        it('keeps `metta release frobnicate` fail-closed as unknown (exit 2)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta release frobnicate'))
          expect(code).toBe(2)
          expect(stderr).toContain('unknown')
        })
      })

      describe('backlog bare-form classification', () => {
        it('allows bare `metta backlog` (read-only list view) without any credential (exit 0)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta backlog'))
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('allows `metta backlog --json` without any credential (exit 0)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta backlog --json'))
          expect(code).toBe(0)
          expect(stderr).toBe('')
        })

        it('keeps `metta backlog frobnicate` fail-closed as unknown (exit 2)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta backlog frobnicate'))
          expect(code).toBe(2)
          expect(stderr).toContain('unknown')
        })
      })

      // ----- Non-Bash / edge cases -----
      it('passes through non-Bash events (tool_name: Edit) (exit 0)', () => {
        const { code } = runHook(hookPath, { tool_name: 'Edit', tool_input: { file_path: 'x.ts' } })
        expect(code).toBe(0)
      })

      it('passes through empty stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: '' })
        expect(code).toBe(0)
      })

      it('passes through malformed JSON stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: 'not-json{' })
        expect(code).toBe(0)
      })

      it('passes through commands with no metta (e.g. `ls -la`) (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('ls -la'))
        expect(code).toBe(0)
      })
    })
  }

  it('source and deployed hook are byte-identical', async () => {
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})
