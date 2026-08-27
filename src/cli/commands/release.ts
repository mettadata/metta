import { Command } from 'commander'
import { askYesNo, createCliContext, handleError, outputJson } from '../helpers.js'
import {
  ReleaseError,
  ReleaseConfigMissingError,
  ReleasePipeline,
} from '../../release/release-pipeline.js'
import type { ReleaseCutResult, ReleaseStep } from '../../release/release-pipeline.js'
import { BumpLevelEnum, type BumpLevel } from '../../schemas/releases-record.js'

function renderSteps(steps: ReleaseStep[]): void {
  for (const step of steps) {
    const detail = step.detail !== undefined ? ` — ${step.detail}` : ''
    console.log(`  ${step.status.padEnd(4)} ${step.step}${detail}`)
  }
}

function renderCutResult(result: ReleaseCutResult, dryRun: boolean): void {
  renderSteps(result.steps)
  if (result.status === 'success') {
    if (dryRun) {
      console.log(`Dry run — release ${result.version ?? ''} (${result.tag ?? ''}) would be cut; nothing was written.`)
      return
    }
    console.log(`Release ${result.version ?? ''} cut (tag ${result.tag ?? ''}).`)
    console.log(
      'The tag was NOT pushed. Push it with: git push --follow-tags origin main — then publish ' +
        `the GitHub release (if configured) with: gh release create ${result.tag ?? '<tag>'} --verify-tag`,
    )
    return
  }
  if (result.status === 'aborted') {
    console.error('Release aborted — nothing was written. Use --yes to skip the confirmation in non-interactive contexts.')
    return
  }
  const failed = result.steps.find(s => s.status === 'fail')
  const detail = failed?.detail !== undefined ? `: ${failed.detail}` : ''
  console.error(`Release failed at step '${failed?.step ?? 'unknown'}'${detail}`)
}

export function registerReleaseCommand(program: Command): void {
  const release = program
    .command('release')
    .description('Version and release management')

  release
    .command('status', { isDefault: true })
    .description('Show current product version, last tag, and recommended bump (read-only)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const json = (opts.json ?? false) || (program.opts().json ?? false)
      try {
        const ctx = createCliContext()
        const config = await ctx.configLoader.load()
        const pipeline = new ReleasePipeline(ctx.projectRoot, config)
        const result = await pipeline.status()

        if (json) {
          outputJson(result)
        } else {
          console.log(`Version:            ${result.version}`)
          console.log(`Last tag:           ${result.lastTag ?? 'none'}`)
          console.log(`Commits since:      ${result.commitCount ?? 'unavailable'}`)
          console.log(`Recommended bump:   ${result.recommendedBump ?? 'unavailable'}`)
          console.log(`Unreleased changes: ${result.unreleasedChanges}`)
          console.log(`On-ship mode:       ${result.onShip}`)
          for (const warning of result.warnings) {
            console.error(`warn: ${warning}`)
          }
        }
      } catch (err) {
        handleError(err, json)
      }
    })

  release
    .command('cut')
    .description('Cut a release locally: bump version, update record and changelog, commit, and tag (never pushes; GitHub publication happens after the tag push)')
    .option('--bump <level>', 'Override the derived bump level (patch|minor|major)')
    .option('--yes', 'Skip the interactive target-version confirmation')
    .option('--github', '(removed) GitHub publication now happens after the tag push — see error for the sequence')
    .option('--dry-run', 'Run all checks but write nothing')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { bump?: string; yes?: boolean; github?: boolean; dryRun?: boolean; json?: boolean }) => {
      const json = (opts.json ?? false) || (program.opts().json ?? false)
      try {
        // --github is removed: error BEFORE any context/config/pipeline work,
        // naming the fixed cut → push → publish sequence. No mutation occurs.
        if (opts.github === true) {
          throw new ReleaseError(
            "--github has been removed from 'release cut': the cut is local-only. " +
              'Publish after the tag is on the remote: (1) metta release cut --bump <level> --yes, ' +
              '(2) git push --follow-tags origin main, ' +
              '(3) gh release create <tag> --verify-tag --notes-file - (requires release.github_release: true).',
          )
        }

        // Validate --bump against the three levels before touching anything.
        const levels = BumpLevelEnum.options
        if (opts.bump !== undefined && !levels.includes(opts.bump as BumpLevel)) {
          const msg = `Invalid --bump '${opts.bump}'. Valid levels: ${[...levels].sort().join(', ')}`
          if (json) {
            outputJson({ error: { code: 4, type: 'validation_error', message: msg } })
          } else {
            console.error(msg)
          }
          process.exit(4)
        }

        const ctx = createCliContext()
        const config = await ctx.configLoader.load()

        // Actionable error naming the required keys, before any read or write.
        if (config.release === undefined) {
          throw new ReleaseConfigMissingError()
        }

        const pipeline = new ReleasePipeline(ctx.projectRoot, config)
        const confirmVersion =
          opts.yes === true
            ? async (): Promise<boolean> => true
            : async (target: string, recommended: BumpLevel, source: 'derived' | 'override'): Promise<boolean> =>
                askYesNo(
                  `Cut release ${target} (${source} bump${source === 'derived' ? '' : `; recommended: ${recommended}`})?`,
                  { jsonMode: json },
                )

        const result = await pipeline.cut({
          bumpOverride: opts.bump as BumpLevel | undefined,
          confirmVersion,
          dryRun: opts.dryRun ?? false,
        })

        if (json) {
          outputJson(result)
        } else {
          renderCutResult(result, opts.dryRun ?? false)
        }
        if (result.status !== 'success') {
          process.exit(1)
        }
      } catch (err) {
        handleError(err, json)
      }
    })
}
