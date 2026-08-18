import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  parsePorcelain,
  diffTreeState,
  BASELINE_DIR,
  baselineRelPath,
  readMainTreeStatus,
  captureMainTreeBaseline,
  compareMainTree,
  deleteMainTreeBaseline,
  MainTreeContaminationError,
} from '../src/util/git-tree-baseline.js'
import { MainTreeBaselineSchema, type MainTreeBaseline, type TreeEntry } from '../src/schemas/tree-baseline.js'
import { StateStore } from '../src/state/state-store.js'

const execAsync = promisify(execFile)
const NUL = '\0'

describe('parsePorcelain (pure)', () => {
  it('returns [] for clean-tree output (empty string)', () => {
    expect(parsePorcelain('')).toEqual([])
  })

  it('parses a single unstaged modification', () => {
    expect(parsePorcelain(` M src/a.ts${NUL}`)).toEqual([
      { path: 'src/a.ts', status: ' M' },
    ])
  })

  it('parses staged+unstaged (MM) and staged-only (M ) codes', () => {
    expect(parsePorcelain(`MM src/a.ts${NUL}M  src/b.ts${NUL}`)).toEqual([
      { path: 'src/a.ts', status: 'MM' },
      { path: 'src/b.ts', status: 'M ' },
    ])
  })

  it('parses -z rename records with the two-field form', () => {
    const raw = `R  new-name.ts${NUL}old-name.ts${NUL} M other.ts${NUL}`
    expect(parsePorcelain(raw)).toEqual([
      { path: 'new-name.ts', status: 'R ', renamed_from: 'old-name.ts' },
      { path: 'other.ts', status: ' M' },
    ])
  })

  it('parses copy records with the two-field form', () => {
    const raw = `C  copy.ts${NUL}source.ts${NUL}`
    expect(parsePorcelain(raw)).toEqual([
      { path: 'copy.ts', status: 'C ', renamed_from: 'source.ts' },
    ])
  })

  it('preserves paths with spaces (NUL-delimited, no quoting)', () => {
    const raw = ` M path with spaces.txt${NUL}A  another spaced file.md${NUL}`
    expect(parsePorcelain(raw)).toEqual([
      { path: 'path with spaces.txt', status: ' M' },
      { path: 'another spaced file.md', status: 'A ' },
    ])
  })

  it('parses a mixed multi-entry record stream', () => {
    const raw = ` M a.ts${NUL}D  gone.ts${NUL}R  moved to.ts${NUL}moved from.ts${NUL}MM c.ts${NUL}`
    expect(parsePorcelain(raw)).toEqual([
      { path: 'a.ts', status: ' M' },
      { path: 'gone.ts', status: 'D ' },
      { path: 'moved to.ts', status: 'R ', renamed_from: 'moved from.ts' },
      { path: 'c.ts', status: 'MM' },
    ])
  })

  it('skips malformed tokens defensively', () => {
    expect(parsePorcelain(`xx${NUL}${NUL} M ok.ts${NUL}`)).toEqual([
      { path: 'ok.ts', status: ' M' },
    ])
  })
})

describe('diffTreeState (pure)', () => {
  const entry = (path: string, status: string): TreeEntry => ({ path, status })

  it('classifies a path absent from the baseline as new dirt', () => {
    const { newDirt, preExisting } = diffTreeState(
      [entry('pre.ts', ' M')],
      [entry('pre.ts', ' M'), entry('fresh.ts', ' M')],
    )
    expect(newDirt).toEqual([entry('fresh.ts', ' M')])
    expect(preExisting).toEqual([entry('pre.ts', ' M')])
  })

  it('counts a status transition ( M -> MM) as new dirt', () => {
    const { newDirt, preExisting } = diffTreeState(
      [entry('a.ts', ' M')],
      [entry('a.ts', 'MM')],
    )
    expect(newDirt).toEqual([entry('a.ts', 'MM')])
    expect(preExisting).toEqual([])
  })

  it('attributes unchanged baseline dirt as pre-existing', () => {
    const { newDirt, preExisting } = diffTreeState(
      [entry('a.ts', ' M'), entry('b.ts', 'MM')],
      [entry('a.ts', ' M'), entry('b.ts', 'MM')],
    )
    expect(newDirt).toEqual([])
    expect(preExisting).toEqual([entry('a.ts', ' M'), entry('b.ts', 'MM')])
  })

  it('returns empty sets for a clean current tree', () => {
    const { newDirt, preExisting } = diffTreeState([entry('a.ts', ' M')], [])
    expect(newDirt).toEqual([])
    expect(preExisting).toEqual([])
  })

  it('handles an empty baseline (everything current is new dirt)', () => {
    const { newDirt, preExisting } = diffTreeState([], [entry('a.ts', ' M')])
    expect(newDirt).toEqual([entry('a.ts', ' M')])
    expect(preExisting).toEqual([])
  })
})

describe('baseline path helpers', () => {
  it('exposes the scratch storage directory', () => {
    expect(BASELINE_DIR).toBe('scratch/tree-baselines')
  })

  it('keys the baseline file by change name', () => {
    expect(baselineRelPath('my-change')).toBe('scratch/tree-baselines/my-change.yaml')
  })
})

describe('imperative shell against a real git repo', () => {
  let repo: string

  beforeEach(async () => {
    // realpath: tmpdir may be a symlink; git prints resolved paths.
    repo = await realpath(await mkdtemp(join(tmpdir(), 'metta-tree-baseline-')))
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.email', 't@t.com'])
    await git(['config', 'user.name', 'T'])
    await writeFile(join(repo, 'tracked.txt'), 'original\n')
    await writeFile(join(repo, 'other.txt'), 'other\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'init'])
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function git(args: string[], cwd: string = repo): Promise<string> {
    const { stdout } = await execAsync('git', args, { cwd })
    return stdout.trim()
  }

  it('readMainTreeStatus reports tracked dirt and ignores untracked files (-uno)', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'dirty\n')
    await writeFile(join(repo, 'untracked.txt'), 'new file\n')
    const entries = await readMainTreeStatus(repo)
    expect(entries).toEqual([{ path: 'tracked.txt', status: ' M' }])
  })

  it('captures a clean baseline and detects new dirt on compare', async () => {
    const capture = await captureMainTreeBaseline(repo, 'change-a')
    expect(capture.created).toBe(true)
    expect(capture.preExisting).toEqual([])

    await writeFile(join(repo, 'tracked.txt'), 'contaminated\n')
    const cmp = await compareMainTree(repo, 'change-a')
    expect(cmp.hasBaseline).toBe(true)
    expect(cmp.newDirt).toEqual([{ path: 'tracked.txt', status: ' M' }])
    expect(cmp.preExisting).toEqual([])
  })

  it('reports pre-existing dirt at capture time and attributes it on compare', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'operator edit\n')
    const capture = await captureMainTreeBaseline(repo, 'change-b')
    expect(capture.created).toBe(true)
    expect(capture.preExisting).toEqual([{ path: 'tracked.txt', status: ' M' }])

    await writeFile(join(repo, 'other.txt'), 'contamination\n')
    const cmp = await compareMainTree(repo, 'change-b')
    expect(cmp.hasBaseline).toBe(true)
    expect(cmp.newDirt).toEqual([{ path: 'other.txt', status: ' M' }])
    expect(cmp.preExisting).toEqual([{ path: 'tracked.txt', status: ' M' }])
  })

  it('flags a status transition of pre-existing dirt as new dirt', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'operator edit\n')
    await captureMainTreeBaseline(repo, 'change-c')

    // Staging the file transitions ' M' -> 'M ' — changed state counts as new.
    await git(['add', 'tracked.txt'])
    const cmp = await compareMainTree(repo, 'change-c')
    expect(cmp.hasBaseline).toBe(true)
    expect(cmp.newDirt).toEqual([{ path: 'tracked.txt', status: 'M ' }])
    expect(cmp.preExisting).toEqual([])
  })

  it('parses real rename records from git', async () => {
    await git(['mv', 'tracked.txt', 'renamed.txt'])
    const entries = await readMainTreeStatus(repo)
    expect(entries).toEqual([
      { path: 'renamed.txt', status: 'R ', renamed_from: 'tracked.txt' },
    ])
  })

  it('is write-once: a second capture keeps the original snapshot', async () => {
    const first = await captureMainTreeBaseline(repo, 'change-d')
    expect(first.created).toBe(true)
    const before = await readFile(
      join(repo, '.metta', baselineRelPath('change-d')),
      'utf8',
    )

    // Dirty the tree, then attempt a re-capture (retry loop shape).
    await writeFile(join(repo, 'tracked.txt'), 'dirt between attempts\n')
    const second = await captureMainTreeBaseline(repo, 'change-d')
    expect(second.created).toBe(false)
    expect(second.preExisting).toEqual([])

    const after = await readFile(
      join(repo, '.metta', baselineRelPath('change-d')),
      'utf8',
    )
    expect(after).toBe(before)

    // The original snapshot still attributes the dirt as new.
    const cmp = await compareMainTree(repo, 'change-d')
    expect(cmp.newDirt).toEqual([{ path: 'tracked.txt', status: ' M' }])
  })

  it('write-once capture of a dirty baseline returns its stored entries', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'pre-existing\n')
    await captureMainTreeBaseline(repo, 'change-e')
    await writeFile(join(repo, 'tracked.txt'), 'original\n') // tree clean again
    const again = await captureMainTreeBaseline(repo, 'change-e')
    expect(again.created).toBe(false)
    expect(again.preExisting).toEqual([{ path: 'tracked.txt', status: ' M' }])
  })

  it('treats a missing baseline as hasBaseline: false', async () => {
    const cmp = await compareMainTree(repo, 'never-captured')
    expect(cmp).toEqual({ hasBaseline: false, newDirt: [], preExisting: [] })
  })

  it('treats a main_root mismatch as a missing baseline', async () => {
    const store = new StateStore(join(repo, '.metta'))
    const baseline: MainTreeBaseline = {
      change: 'moved-change',
      main_root: '/somewhere/else/entirely',
      recorded_at: new Date().toISOString(),
      entries: [],
    }
    await store.write(baselineRelPath('moved-change'), MainTreeBaselineSchema, baseline)

    await writeFile(join(repo, 'tracked.txt'), 'dirty\n')
    const cmp = await compareMainTree(repo, 'moved-change')
    expect(cmp).toEqual({ hasBaseline: false, newDirt: [], preExisting: [] })
  })

  it('treats an unreadable (schema-invalid) baseline as missing', async () => {
    const store = new StateStore(join(repo, '.metta'))
    await store.writeRaw(baselineRelPath('corrupt'), 'not: [a, baseline\n')
    const cmp = await compareMainTree(repo, 'corrupt')
    expect(cmp).toEqual({ hasBaseline: false, newDirt: [], preExisting: [] })
  })

  it('round-trips the baseline schema through StateStore', async () => {
    const store = new StateStore(join(repo, '.metta'))
    const baseline: MainTreeBaseline = {
      change: 'round-trip',
      main_root: repo,
      recorded_at: '2026-08-18T12:00:00.000Z',
      entries: [
        { path: 'path with spaces.txt', status: ' M' },
        { path: 'renamed.txt', status: 'R ', renamed_from: 'tracked.txt' },
      ],
    }
    await store.write(baselineRelPath('round-trip'), MainTreeBaselineSchema, baseline)
    const read = await store.read(baselineRelPath('round-trip'), MainTreeBaselineSchema)
    expect(read).toEqual(baseline)
  })

  it('capture persists a schema-valid baseline file under scratch/tree-baselines', async () => {
    await captureMainTreeBaseline(repo, 'change-f')
    const store = new StateStore(join(repo, '.metta'))
    const stored = await store.read(baselineRelPath('change-f'), MainTreeBaselineSchema)
    expect(stored.change).toBe('change-f')
    expect(stored.main_root).toBe(repo)
    expect(stored.entries).toEqual([])
    expect(() => new Date(stored.recorded_at)).not.toThrow()
  })

  it('detection never mutates the checkout (git status only)', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'my in-flight edit\n')
    await captureMainTreeBaseline(repo, 'change-g')
    await compareMainTree(repo, 'change-g')
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('my in-flight edit\n')
    expect(await git(['status', '--porcelain', '-uno'])).toContain('tracked.txt')
  })

  it('deleteMainTreeBaseline removes the file and is a no-op when absent', async () => {
    await captureMainTreeBaseline(repo, 'change-h')
    const fullPath = join(repo, '.metta', baselineRelPath('change-h'))
    await deleteMainTreeBaseline(repo, 'change-h')
    await expect(stat(fullPath)).rejects.toThrow()
    // Second delete (missing file) must not throw — best-effort.
    await expect(deleteMainTreeBaseline(repo, 'change-h')).resolves.toBeUndefined()
  })
})

describe('MainTreeContaminationError', () => {
  it('carries the new-dirt entries and a typed name', () => {
    const dirt: TreeEntry[] = [{ path: 'src/f.ts', status: ' M' }]
    const err = new MainTreeContaminationError('main checkout contaminated', dirt)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MainTreeContaminationError')
    expect(err.message).toBe('main checkout contaminated')
    expect(err.newDirt).toEqual(dirt)
  })
})
