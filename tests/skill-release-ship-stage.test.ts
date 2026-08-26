import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const SKILL_TREES = ['src/templates/skills', '.claude/skills'] as const
const SHIP_SKILLS = [
  'metta-ship',
  'metta-propose',
  'metta-quick',
  'metta-auto',
  'metta-fix-issues',
  'metta-fix-gap',
] as const

// Frozen copy of the canonical release-stage sentence — copied byte-exact from
// src/templates/skills/metta-ship/SKILL.md. Never retype it.
const RELEASE_STAGE_SENTENCE =
  'Post-merge release stage (runs only after the user-approved PR merge, git pull --ff-only, and dist rebuild — never at a PR-open hand-back): resolve the effective release.on_ship mode via metta release status --json, and on auto (or a confirmed prompt) derive the bump, run metta release cut --bump <level> --yes --json, push the release commit and tag with git push --follow-tags origin main, then — only when githubRelease is true — probe gh release view <tag> and publish with gh release create <tag> --verify-tag --notes-file -, treating every failure in this stage as warn-and-continue: report what failed, state that /metta-release cuts it on demand, and never unwind or block the completed ship.'
const PR_MERGE_CMD = 'gh pr merge <pr-number> --merge'
const MAIN_PULL_CMD = 'git pull --ff-only'
const VERIFY_TAG_FLAG = '--verify-tag'
const RELEASE_PUSH_CMD = 'git push --follow-tags origin main'
const GH_RELEASE_VIEW_CMD = 'gh release view <tag>'
const GH_RELEASE_CREATE_CMD = 'gh release create'
// Anchor for the metta-propose --ship opt-in section (the release stage must sit
// inside the opt-in merge path, never in the default PR-open hand-back path).
const PROPOSE_SHIP_OPTIN_ANCHOR = 'Ship opt-in — the following sub-steps run ONLY'
// metta-release step 4 wording — the per-run push confirmation that must precede publishing.
const RELEASE_PUSH_CONFIRM_WORDING = 'explicit per-run push confirmation'

// 12 [label, absolutePath] tuples — the label doubles as the offender name in failures
const cases = SKILL_TREES.flatMap((tree) =>
  SHIP_SKILLS.map(
    (skill) => [`${tree}/${skill}/SKILL.md`, join(REPO_ROOT, tree, skill, 'SKILL.md')] as const,
  ),
)

describe.each(cases)('post-merge release stage — %s', (label, filePath) => {
  it('contains the byte-identical release-stage sentence exactly once', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(
      contents.split(RELEASE_STAGE_SENTENCE).length - 1,
      `${label}: release-stage sentence count`,
    ).toBe(1)
  })

  it('places the release stage after the PR merge step', async () => {
    const contents = await readFile(filePath, 'utf8')
    const stage = contents.indexOf(RELEASE_STAGE_SENTENCE)
    const merge = contents.indexOf(PR_MERGE_CMD)
    expect(stage, `${label}: release-stage sentence missing`).toBeGreaterThan(-1)
    expect(merge, `${label}: PR merge step missing`).toBeGreaterThan(-1)
    expect(stage, `${label}: release stage must follow gh pr merge`).toBeGreaterThan(merge)
  })

  it('places the release stage after the main pull', async () => {
    const contents = await readFile(filePath, 'utf8')
    const stage = contents.indexOf(RELEASE_STAGE_SENTENCE)
    const pull = contents.indexOf(MAIN_PULL_CMD)
    expect(stage, `${label}: release-stage sentence missing`).toBeGreaterThan(-1)
    expect(pull, `${label}: git pull --ff-only step missing`).toBeGreaterThan(-1)
    expect(stage, `${label}: release stage must follow git pull --ff-only`).toBeGreaterThan(pull)
  })

  it('carries the release block commands (--verify-tag, follow-tags push, gh release view)', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(contents, `${label}: missing ${VERIFY_TAG_FLAG}`).toContain(VERIFY_TAG_FLAG)
    expect(contents, `${label}: missing ${RELEASE_PUSH_CMD}`).toContain(RELEASE_PUSH_CMD)
    expect(contents, `${label}: missing ${GH_RELEASE_VIEW_CMD}`).toContain(GH_RELEASE_VIEW_CMD)
  })
})

describe.each(
  SKILL_TREES.map(
    (tree) =>
      [`${tree}/metta-propose/SKILL.md`, join(REPO_ROOT, tree, 'metta-propose', 'SKILL.md')] as const,
  ),
)('metta-propose ship opt-in scoping — %s', (label, filePath) => {
  it('places the release stage inside the --ship opt-in section (no release wording at PR-open)', async () => {
    const contents = await readFile(filePath, 'utf8')
    const stage = contents.indexOf(RELEASE_STAGE_SENTENCE)
    const optIn = contents.indexOf(PROPOSE_SHIP_OPTIN_ANCHOR)
    expect(stage, `${label}: release-stage sentence missing`).toBeGreaterThan(-1)
    expect(optIn, `${label}: --ship opt-in anchor missing`).toBeGreaterThan(-1)
    expect(
      stage,
      `${label}: release stage must sit inside the --ship opt-in section`,
    ).toBeGreaterThan(optIn)
  })
})

describe.each(
  SKILL_TREES.map(
    (tree) =>
      [`${tree}/metta-release/SKILL.md`, join(REPO_ROOT, tree, 'metta-release', 'SKILL.md')] as const,
  ),
)('metta-release on-demand skill — %s', (label, filePath) => {
  it('carries --verify-tag and the follow-tags push command', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(contents, `${label}: missing ${VERIFY_TAG_FLAG}`).toContain(VERIFY_TAG_FLAG)
    expect(contents, `${label}: missing ${RELEASE_PUSH_CMD}`).toContain(RELEASE_PUSH_CMD)
  })

  it('contains zero --github occurrences (flag removed from cut)', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(
      contents.split('--github').length - 1,
      `${label}: --github occurrence count`,
    ).toBe(0)
  })

  it('places the per-run push confirmation before gh release create', async () => {
    const contents = await readFile(filePath, 'utf8')
    const confirm = contents.indexOf(RELEASE_PUSH_CONFIRM_WORDING)
    const create = contents.indexOf(GH_RELEASE_CREATE_CMD)
    expect(confirm, `${label}: push-confirmation wording missing`).toBeGreaterThan(-1)
    expect(create, `${label}: gh release create step missing`).toBeGreaterThan(-1)
    expect(
      confirm,
      `${label}: push confirmation must precede gh release create`,
    ).toBeLessThan(create)
  })
})

describe('post-merge release stage — aggregate coverage', () => {
  it('the release-stage sentence appears verbatim in all six ship-path skills in both trees', async () => {
    const missing: string[] = []
    for (const [label, filePath] of cases) {
      const contents = await readFile(filePath, 'utf8')
      if (!contents.includes(RELEASE_STAGE_SENTENCE)) missing.push(label)
    }
    expect(
      missing,
      `Files missing the byte-identical release-stage sentence:\n${missing.join('\n')}`,
    ).toEqual([])
  })
})
