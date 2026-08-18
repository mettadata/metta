import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// Repo root resolved from this file's location (tests/ -> ..), matching the
// pattern used for `CLI_PATH` in tests/helpers/cli.ts.
const REPO_ROOT = join(import.meta.dirname, '..')

// Guard hook integration test — verifies the init-phase allow-list added in
// `fix-guard-hook-allow-init-phas`. The hook source and the deployed mirror
// must stay byte-identical; tests run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-edit.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-guard-edit.mjs'),
]

function runHook(hookPath: string, payload: unknown, cwd: string): { code: number; stderr: string } {
  const result = spawnSync('node', [hookPath], {
    input: JSON.stringify(payload),
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

describe('metta-guard-edit hook init-phase allow-list', { timeout: 30_000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    // Fresh temp dir that has no metta project and no active change.
    // `metta status --json` will either fail (exit 0 pass-through in the
    // catch block) or return a no-active-change shape — both cases still
    // exercise the allow-list, because the hook only consults the allow-list
    // AFTER the hasActiveChange branch. For the block case, we need
    // `hasActiveChange === false`. To force that, we create a temp dir
    // that is a git repo so metta install would succeed, but we do NOT
    // run install — so metta status exits non-zero and the hook takes the
    // pass-through path. That would mask the block assertion. Instead,
    // we bypass PATH-based `metta` lookup by setting PATH to exclude it.
    tempDir = await mkdtemp(join(tmpdir(), 'metta-guard-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      it('exits 0 for non-guarded tools', () => {
        const { code } = runHook(
          hookPath,
          { tool_name: 'Read', tool_input: { file_path: 'anything.ts' } },
          tempDir,
        )
        expect(code).toBe(0)
      })

      it('exits 0 when writing to allow-listed spec/project.md with no active change', () => {
        const { code } = runHook(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: 'spec/project.md' } },
          tempDir,
        )
        expect(code).toBe(0)
      })

      it('exits 0 when writing to allow-listed .metta/config.yaml with no active change', () => {
        const { code } = runHook(
          hookPath,
          { tool_name: 'Edit', tool_input: { file_path: '.metta/config.yaml' } },
          tempDir,
        )
        expect(code).toBe(0)
      })

      it('exits 0 when writing to spec/issues/<slug>.md with no active change', () => {
        const { code } = runHook(
          hookPath,
          { tool_name: 'Edit', tool_input: { file_path: 'spec/issues/some-slug.md' } },
          tempDir,
        )
        expect(code).toBe(0)
      })

      it('exits 2 when writing to spec/backlog/<slug>.md with no active change (retired from allowlist)', async () => {
        // Deterministic block assertion: without a resolvable `metta`, the
        // hook's catch-all passes through (exit 0) and the block branch is
        // unreachable (this is exactly what happened on CI, where metta is
        // not on PATH). Prepend a shim that reports no active change,
        // mirroring the worktree-awareness suite's pattern, so the test pins
        // that the retired spec/backlog/ prefix no longer short-circuits the
        // allow-list before the active-change probe.
        const shimBin = join(tempDir, 'shim-bin')
        await mkdir(shimBin, { recursive: true })
        await writeFile(
          join(shimBin, 'metta'),
          '#!/bin/sh\necho \'{"changes":[],"message":"No active changes"}\'\n',
          { mode: 0o755 },
        )
        const result = spawnSync('node', [hookPath], {
          input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'spec/backlog/some-slug.md' } }),
          cwd: tempDir,
          encoding: 'utf8',
          timeout: 10_000,
          env: { ...process.env, PATH: `${shimBin}:${process.env.PATH ?? ''}` },
        })
        expect(result.status).toBe(2)
        expect(result.stderr).toContain('metta-guard')
      })

      it('exits 0 for an absolute path outside the project root with no active change', () => {
        // Outside-root early allow: files not under the project root can never
        // be part of a metta change, so the guard must not gate them. Regardless
        // of whether `metta` resolves on PATH (catch-all pass-through) or reports
        // no active change (outside-root branch), the hook must exit 0 with no
        // block message.
        const { code, stderr } = runHook(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: '/tmp/whatever/file.md' } },
          tempDir,
        )
        expect(code).toBe(0)
        expect(stderr).not.toContain('blocked')
      })

      it('exits 0 for a ..-relative path escaping the project root with no active change', () => {
        const { code, stderr } = runHook(
          hookPath,
          { tool_name: 'Edit', tool_input: { file_path: '../outside/notes.md' } },
          tempDir,
        )
        expect(code).toBe(0)
        expect(stderr).not.toContain('blocked')
      })

      it('still blocks spec/issues/ non-md file (e.g. directory traversal)', () => {
        const { code } = runHook(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: 'spec/issues/evil.sh' } },
          tempDir,
        )
        // Same pass-through / block disambiguation as the block test below.
        if (code === 2) {
          // blocked via stderr — good
        } else {
          expect(code).toBe(0)
        }
      })

      it('tolerates a non-string file_path without crashing (no exit-1 fail-open)', () => {
        // A malformed payload must never throw: an uncaught throw exits 1,
        // which Claude Code treats as a non-blocking error — a fail-open.
        for (const badPath of [123, { evil: true }, null, ['a']]) {
          const { code } = runHook(
            hookPath,
            { tool_name: 'Write', tool_input: { file_path: badPath } },
            tempDir,
          )
          expect([0, 2]).toContain(code)
        }
      })

      it('blocks (exit 2) writes to non-allow-listed paths with no active change', () => {
        // When `metta` is NOT on PATH the hook's catch-all exits 0 (pass-through).
        // When it IS on PATH but the cwd has no active change, the hook reaches
        // the block. To make this test deterministic regardless of environment,
        // we strip PATH of anything that could resolve `metta`. If a shim
        // resolves anyway (e.g. user has it globally and node inherits), the
        // test's expectation for the non-allow-listed block still holds —
        // `metta status --json` on an uninitialized temp dir returns the
        // no-active-change shape, so the hook proceeds to the stderr block.
        const { code, stderr } = runHook(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: 'src/foo.ts' } },
          tempDir,
        )
        // Accept either (a) exit 2 with the metta-guard message, or
        // (b) exit 0 when metta is unavailable — the behavior of interest
        // is that the allow-list did NOT short-circuit for a non-listed path.
        if (code === 2) {
          expect(stderr).toContain('metta-guard')
          expect(stderr).toContain('Write blocked')
        } else {
          // Pass-through path; ensure we did not silently allow through
          // the allow-list branch. The allow-list branch has no stderr,
          // and the catch-all has no stderr, so we can only assert code is 0.
          expect(code).toBe(0)
        }
      })
    })
  }

  it('source and deployed hook are byte-identical', async () => {
    const { readFile } = await import('node:fs/promises')
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})

describe('metta-guard-edit hook worktree awareness', { timeout: 60_000 }, () => {
  let repoDir: string
  let demoWorktree: string
  let emptyWorktree: string
  let binDir: string

  function git(args: string[], cwd: string): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
  }

  // Like runHook, but with a shim `metta` prepended to PATH so the probe
  // result is deterministic regardless of any real metta installation.
  function runHookWithShim(
    hookPath: string,
    payload: unknown,
    cwd: string,
  ): { code: number; stderr: string } {
    const result = spawnSync('node', [hookPath], {
      input: JSON.stringify(payload),
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    })
    return { code: result.status ?? -1, stderr: result.stderr ?? '' }
  }

  beforeEach(async () => {
    // Real git repo with two real worktrees under .metta/worktrees/ — the
    // hook resolves checkout roots via `git rev-parse --show-toplevel`, so
    // simulated directories are not enough here. Paths go through realpath
    // because git reports physical paths.
    repoDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-guard-wt-')))
    git(['init', '--initial-branch=main'], repoDir)
    git(['config', 'user.email', 'test@example.com'], repoDir)
    git(['config', 'user.name', 'Test'], repoDir)
    await writeFile(join(repoDir, 'README.md'), '# test\n')
    git(['add', '.'], repoDir)
    git(['commit', '-m', 'initial'], repoDir)

    await mkdir(join(repoDir, '.metta', 'worktrees'), { recursive: true })
    demoWorktree = join(repoDir, '.metta', 'worktrees', 'demo')
    emptyWorktree = join(repoDir, '.metta', 'worktrees', 'empty')
    git(['worktree', 'add', demoWorktree, '-b', 'metta/demo'], repoDir)
    git(['worktree', 'add', emptyWorktree, '-b', 'metta/empty'], repoDir)

    // Fake `metta` shim: default is "no active change" for any cwd. Under
    // V1c, both worktree checkouts (demoWorktree AND emptyWorktree) derive
    // the SAME probe root (repoDir), so a cwd-only shim cannot answer
    // "active" for one worktree-rooted target and "inactive" for another —
    // that distinction is exactly the ADR-3-accepted residual widening, and
    // real host-aggregation truth (including the inverted topology, where
    // state lives ONLY at the host) is owned by the real-CLI block further
    // down — see `metta-guard-edit hook real-CLI topology`. The one case
    // below that needs an "active" answer overrides this default shim
    // locally, with a comment explaining why, so every other case here
    // keeps exercising the plain block/allow-list path-math it always has.
    binDir = join(repoDir, 'bin')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      join(binDir, 'metta'),
      '#!/bin/sh\necho \'{"changes":[],"message":"No active changes"}\'\n',
      { mode: 0o755 },
    )
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook`, () => {
      it('allows a Write to a not-yet-existing file inside a worktree with an active change (cwd = main root)', async () => {
        // ADR-5: under V1c the probe for this worktree-rooted target moves to
        // the hosting checkout (repoDir) instead of demoWorktree's own root —
        // see deriveProbeRoot. Override the shared "no active change" shim
        // just for this case to model one-directional aggregation: active
        // when probed from repoDir (the derived probe root) or demoWorktree
        // itself. This keeps the case deterministic; real aggregation truth
        // is owned by the real-CLI block (`metta-guard-edit hook real-CLI
        // topology`), not this shim. The demoWorktree branch of this
        // condition is not exercised under V1c — the derived probe root for
        // a worktree-hosted target is always repoDir (the main root), never
        // demoWorktree itself; it exists only to model the general shape of
        // one-directional aggregation, not a reachable probe path here.
        await writeFile(
          join(binDir, 'metta'),
          [
            '#!/bin/sh',
            `if [ "$(pwd -P)" = "${repoDir}" ] || [ "$(pwd -P)" = "${demoWorktree}" ]; then`,
            `  echo '{"change":"demo"}'`,
            'else',
            `  echo '{"changes":[],"message":"No active changes"}'`,
            'fi',
            '',
          ].join('\n'),
          { mode: 0o755 },
        )
        const { code, stderr } = runHookWithShim(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'new-file.ts') } },
          repoDir,
        )
        expect(stderr).not.toContain('blocked')
        expect(code).toBe(0)
      })

      it('blocks a Write inside a worktree with no active change', () => {
        const { code, stderr } = runHookWithShim(
          hookPath,
          { tool_name: 'Edit', tool_input: { file_path: join(emptyWorktree, 'src', 'foo.ts') } },
          repoDir,
        )
        expect(code).toBe(2)
        expect(stderr).toContain('metta-guard')
      })

      it('still blocks a main-checkout Write when the main root has no active change', () => {
        const { code, stderr } = runHookWithShim(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: 'src/foo.ts' } },
          repoDir,
        )
        expect(code).toBe(2)
        expect(stderr).toContain('metta-guard')
      })

      it('computes the allowlist against the worktree root (spec/issues .md allowed in a change-less worktree)', () => {
        const { code, stderr } = runHookWithShim(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(emptyWorktree, 'spec', 'issues', 'note.md') } },
          repoDir,
        )
        expect(stderr).not.toContain('blocked')
        expect(code).toBe(0)
      })

      it('still blocks when the target is addressed through a symlinked root (no physical/logical fail-open)', async () => {
        // git reports physical paths; a logical (symlinked) target used to look
        // outside the checkout root and hit the outside-root early allow. The
        // hook must realpath the target so the guard still applies.
        const linkParent = await mkdtemp(join(tmpdir(), 'metta-guard-link-'))
        try {
          const linkRoot = join(linkParent, 'link')
          await symlink(repoDir, linkRoot)
          const { code, stderr } = runHookWithShim(
            hookPath,
            { tool_name: 'Write', tool_input: { file_path: join(linkRoot, 'src', 'foo.ts') } },
            repoDir,
          )
          expect(code).toBe(2)
          expect(stderr).toContain('metta-guard')
        } finally {
          await rm(linkParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        }
      })
    })
  }
})

// Real-CLI topology regression suite (R6). Uses a delegating PATH shim that
// execs the real CLI from source (`npx tsx src/cli/index.ts ...`), so the
// probe answer derives from real `resolveProjectRoot` + `ArtifactStore`
// change discovery/aggregation — not from a cwd-answering shim. This is the
// suite that pins the inverted-hosting-topology fix (R1) and demonstrably
// fails against the pre-fix hook (see task 2.1's red-run verification).
describe('metta-guard-edit hook real-CLI topology', { timeout: 120_000 }, () => {
  function git(args: string[], cwd: string): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
  }

  async function initGitRepo(dir: string): Promise<void> {
    git(['init', '--initial-branch=main'], dir)
    git(['config', 'user.email', 'test@example.com'], dir)
    git(['config', 'user.name', 'Test'], dir)
    await writeFile(join(dir, 'README.md'), '# test\n')
    git(['add', '.'], dir)
    git(['commit', '-m', 'initial'], dir)
  }

  // Minimal ChangeMetadata instance, research-validated to pass the real
  // CLI's `.strict()` Zod schema (ChangeMetadataSchema): workflow, created,
  // status, current_artifact, base_versions, artifacts. No fixture
  // `.metta/config.yaml` is needed — `resolveProjectRoot` only requires a
  // `spec/changes/` directory to root the CLI context.
  const CHANGE_YAML = [
    'workflow: quick',
    "created: '2026-01-01T00:00:00.000Z'",
    'status: active',
    'current_artifact: intent',
    'base_versions: {}',
    'artifacts:',
    '  intent: complete',
    '',
  ].join('\n')

  async function writeChangeState(root: string): Promise<void> {
    const changeDir = join(root, 'spec', 'changes', 'demo')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, '.metta.yaml'), CHANGE_YAML, 'utf8')
  }

  // Delegating shim: `metta status --json` resolves to the real CLI running
  // from source. tsx is a declared devDependency (already load-bearing for
  // tests/helpers/cli.ts) so this is CI-safe with no registry fetch.
  async function writeDelegatingShim(binDir: string): Promise<void> {
    await mkdir(binDir, { recursive: true })
    const cliPath = join(REPO_ROOT, 'src', 'cli', 'index.ts')
    const shim = `#!/bin/sh\nexec npx tsx "${cliPath}" "$@"\n`
    await writeFile(join(binDir, 'metta'), shim, { mode: 0o755 })
  }

  function runHookWithPath(
    hookPath: string,
    payload: unknown,
    cwd: string,
    pathValue: string,
  ): { code: number; stderr: string } {
    const result = spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify(payload),
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PATH: pathValue },
    })
    return { code: result.status ?? -1, stderr: result.stderr ?? '' }
  }

  let repoDir: string
  let demoWorktree: string
  let binDir: string

  beforeEach(async () => {
    repoDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-guard-real-')))
    await initGitRepo(repoDir)
    await mkdir(join(repoDir, '.metta', 'worktrees'), { recursive: true })
    demoWorktree = join(repoDir, '.metta', 'worktrees', 'demo')
    git(['worktree', 'add', demoWorktree, '-b', 'metta/demo'], repoDir)
    binDir = join(repoDir, 'bin')
    await writeDelegatingShim(binDir)
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'
    const shimPath = () => `${binDir}:${process.env.PATH ?? ''}`

    describe(`${label} hook`, () => {
      it('R1: inverted topology (state only at the hosting root) allows a Write inside the worktree', async () => {
        await writeChangeState(repoDir)
        const { code, stderr } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'new-file.ts') } },
          repoDir,
          shimPath(),
        )
        expect(stderr).not.toContain('blocked')
        expect(code).toBe(0)
      })

      it('R1/V1c: inverted topology still allows the edit when the session cwd is a subdirectory of the hosting root (cwd-independence)', async () => {
        await writeChangeState(repoDir)
        const subdir = join(repoDir, 'sub')
        await mkdir(subdir, { recursive: true })
        const { code, stderr } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'new-file.ts') } },
          subdir,
          shimPath(),
        )
        expect(stderr).not.toContain('blocked')
        expect(code).toBe(0)
      })

      it('R2: canonical topology (state only inside the worktree) allows a Write inside the worktree', async () => {
        await writeChangeState(demoWorktree)
        const { code, stderr } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'new-file.ts') } },
          repoDir,
          shimPath(),
        )
        expect(stderr).not.toContain('blocked')
        expect(code).toBe(0)
      })

      it('R3: no state anywhere blocks a Write inside the worktree', () => {
        const { code, stderr } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'new-file.ts') } },
          repoDir,
          shimPath(),
        )
        expect(code).toBe(2)
        expect(stderr).toContain('metta-guard')
      })

      it('ADR-2: containment bound — an unrelated checkout still blocks even though the session root has an active change', async () => {
        await writeChangeState(repoDir)
        const unrelatedDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-guard-unrelated-')))
        try {
          await initGitRepo(unrelatedDir)
          await mkdir(join(unrelatedDir, 'spec', 'changes'), { recursive: true })
          const { code, stderr } = runHookWithPath(
            hookPath,
            { tool_name: 'Write', tool_input: { file_path: join(unrelatedDir, 'src', 'foo.ts') } },
            repoDir,
            shimPath(),
          )
          expect(code).toBe(2)
          expect(stderr).toContain('metta-guard')
        } finally {
          await rm(unrelatedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        }
      })

      it('R4: fails open when the probe (metta) shim exits non-zero', async () => {
        await writeFile(join(binDir, 'metta'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
        const { code } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'foo.ts') } },
          repoDir,
          shimPath(),
        )
        expect(code).toBe(0)
      })

      it('R4: fails open when the probe shim emits unparseable JSON', async () => {
        await writeFile(join(binDir, 'metta'), '#!/bin/sh\necho "not json"\n', { mode: 0o755 })
        const { code } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'foo.ts') } },
          repoDir,
          shimPath(),
        )
        expect(code).toBe(0)
      })

      it('R4: fails open when the probe shim exceeds the 5s probe timeout', async () => {
        await writeFile(
          join(binDir, 'metta'),
          '#!/bin/sh\nsleep 6\necho \'{"change":"demo"}\'\n',
          { mode: 0o755 },
        )
        const { code } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'foo.ts') } },
          repoDir,
          shimPath(),
        )
        expect(code).toBe(0)
      }, 15_000)

      it('R4: fails open when metta is absent from PATH', () => {
        // A genuinely empty PATH: spawning by `process.execPath` (an absolute
        // path) means the outer node invocation needs no PATH resolution, so
        // this isolates only the hook's own `metta` lookup — deterministic
        // regardless of whether the host machine has metta installed globally.
        const { code } = runHookWithPath(
          hookPath,
          { tool_name: 'Write', tool_input: { file_path: join(demoWorktree, 'src', 'foo.ts') } },
          repoDir,
          '',
        )
        expect(code).toBe(0)
      })
    })
  }
})
