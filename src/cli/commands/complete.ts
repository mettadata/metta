import { Command } from 'commander'
import { createCliContext, outputJson, color, agentBanner, askYesNo } from '../helpers.js'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseStories, StoriesParseError } from '../../specs/stories-parser.js'
import { validateFulfillsRefs } from '../../stories/story-validator.js'
import { parseSpec, parseDeltaSpec } from '../../specs/spec-parser.js'
import { readFile } from 'node:fs/promises'
import { toSlug } from '../../util/slug.js'
import { scoreFromIntentImpact, scoreFromSummaryFiles, isScorePresent, renderBanner } from '../../complexity/index.js'
import type { ArtifactStatus } from '../../schemas/change-metadata.js'

const TIER_RANK: Record<string, number> = {
  trivial: 0,
  quick: 1,
  standard: 2,
  full: 3,
}

function tierRank(name: string): number {
  return TIER_RANK[name] ?? -1
}

// Planning artifacts that should be dropped from the artifact map when
// collapsing to a smaller workflow. Only dropped when status is 'pending'
// or 'ready' (never 'in_progress', 'complete', 'failed', 'skipped').
const DROPPABLE_PLANNING_ARTIFACTS = new Set([
  'stories', 'spec', 'research', 'design', 'tasks', 'domain-research',
  'architecture', 'ux-spec',
])

const execAsync = promisify(execFile)

const MIN_CONTENT_BYTES = 200
const SUMMARY_MIN_CONTENT_BYTES = 100
const STUB_MARKERS = [
  'intent stub', 'summary stub', 'spec stub', 'research stub',
  'design stub', 'tasks stub', 'stories stub', 'architecture stub',
  'verify stub', 'domain-research stub', 'ux-spec stub',
]

export function registerCompleteCommand(program: Command): void {
  program
    .command('complete')
    .description('Mark an artifact as complete and get next steps')
    .argument('<artifact>', 'Artifact ID to mark complete')
    .option('--change <name>', 'Change name')
    .action(async (artifactId, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`)

        // Verify the artifact file exists
        const metadata = await ctx.artifactStore.getChange(changeName)
        if (!(artifactId in metadata.artifacts)) {
          throw new Error(`Artifact '${artifactId}' not in workflow. Available: ${Object.keys(metadata.artifacts).join(', ')}`)
        }

        // Look up the generates field from the workflow definition
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(metadata.workflow, [projectWorkflows, builtinWorkflows])
        const artifactDef = graph.artifacts.find(a => a.id === artifactId)
        const generates = artifactDef?.generates ?? `${artifactId}.md`

        // Skip file check for wildcard generates (implementation produces **/*) and summary.md
        const isWildcard = generates.includes('*')
        if (!isWildcard) {
          const fileExists = await ctx.artifactStore.artifactExists(changeName, generates)
          if (!fileExists) {
            throw new Error(`Artifact file '${generates}' not found in spec/changes/${changeName}/. Write the file before marking complete.`)
          }

          // Content sanity check — block stub/placeholder artifacts
          const content = await ctx.artifactStore.readArtifact(changeName, generates)
          const contentTrimmed = content.trim()
          const contentLower = contentTrimmed.toLowerCase()
          const foundStub = STUB_MARKERS.find(m => contentLower.includes(m))
          if (foundStub) {
            throw new Error(
              `Artifact '${generates}' contains placeholder text '${foundStub}'. ` +
              `Fill in real content before marking complete.`,
            )
          }
          // summary.md may legitimately be short for trivial changes; use a lower floor.
          const minBytes = generates === 'summary.md' ? SUMMARY_MIN_CONTENT_BYTES : MIN_CONTENT_BYTES
          if (contentTrimmed.length < minBytes) {
            throw new Error(
              `Artifact '${generates}' is too short (${contentTrimmed.length} bytes, min ${minBytes}). ` +
              `Fill in real content before marking complete.`,
            )
          }
          // Unfilled {change_name} in H1 heading
          const firstLine = contentTrimmed.split('\n')[0] ?? ''
          if (firstLine.startsWith('#') && firstLine.includes('{change_name}')) {
            throw new Error(
              `Artifact '${generates}' H1 heading still contains template placeholder '{change_name}'. ` +
              `Replace it with the real change name before marking complete.`,
            )
          }

          // Pre-complete stories-valid gate
          if (artifactId === 'stories') {
            const storiesPath = join(ctx.projectRoot, 'spec', 'changes', changeName, generates)
            try {
              const stories = await parseStories(storiesPath)
              const specPath = join(ctx.projectRoot, 'spec', 'changes', changeName, 'spec.md')
              if (existsSync(specPath)) {
                const spec = await parseSpec(specPath)
                const allRefs = spec.requirements.flatMap(r => r.fulfills ?? [])
                const errors = validateFulfillsRefs(allRefs, stories)
                if (errors.length > 0) {
                  throw new Error(
                    `stories.md has ${errors.length} validation error(s): ` +
                    errors.map(e => e.message).join('; '),
                  )
                }
              }
            } catch (err) {
              if (err instanceof StoriesParseError) {
                throw new Error(`stories.md parse error: ${err.message}`)
              }
              throw err
            }
          }

          // Pre-complete spec-delta target-capability gate
          if (artifactId === 'spec') {
            const specPath = join(ctx.projectRoot, 'spec', 'changes', changeName, generates)
            const deltaContent = await readFile(specPath, 'utf8')
            const deltaSpec = parseDeltaSpec(deltaContent)
            const capabilityName = toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))
            const capSpecPath = join(ctx.projectRoot, 'spec', 'specs', capabilityName, 'spec.md')
            const capExists = existsSync(capSpecPath)
            for (const delta of deltaSpec.deltas) {
              if ((delta.operation === 'MODIFIED' || delta.operation === 'REMOVED' || delta.operation === 'RENAMED') && !capExists) {
                const suggestion = delta.operation === 'MODIFIED'
                  ? `Did you mean 'ADDED: Requirement: ${delta.requirement.name}'?`
                  : `Remove this delta since the capability doesn't exist yet.`
                throw new Error(
                  `Delta '${delta.operation}: Requirement: ${delta.requirement.name}' targets unknown capability '${capabilityName}'. ${suggestion}`,
                )
              }
            }
          }
        }

        // Mark complete
        await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')

        // The workflow graph used by the downstream "next artifact" logic.
        // Defaults to the graph loaded for the current workflow above; after a
        // downscale/upscale this is replaced with the target graph so getNext
        // operates on the post-mutation workflow shape.
        let activeGraph = graph

        // Intent-time complexity scoring and downscale prompt
        if (artifactId === 'intent') {
          try {
            const intentMd = await ctx.artifactStore.readArtifact(changeName, 'intent.md')
            const score = scoreFromIntentImpact(intentMd)
            const currentMetadata = await ctx.artifactStore.getChange(changeName)

            // Persist complexity_score only when not already present -- never overwrite.
            if (score !== null && !isScorePresent(currentMetadata)) {
              await ctx.artifactStore.updateChange(changeName, { complexity_score: score })
            }

            if (score !== null) {
              const recommendedTier = score.recommended_workflow
              const currentWorkflow = currentMetadata.workflow
              const recRank = tierRank(recommendedTier)
              const chosenRank = tierRank(currentWorkflow)
              // Track whether an advisory banner has already been emitted so
              // downscale/upscale paths do not double-print.
              let bannerEmitted = false

              // Downscale branch: recommendation is a strictly lower tier.
              // Guard: only fire when the chosen workflow is `standard` or `full`.
              // Per spec.md AutoDownscalePromptAtIntent, the downscale prompt
              // MUST NOT fire for `/metta-quick` runs (quick is the smallest
              // named interactive workflow); a quick run scoring trivial is
              // handled by the intra-quick fan-out gate in the skill template.
              const downscaleEligibleChosen =
                currentWorkflow === 'standard' || currentWorkflow === 'full'
              if (
                recRank >= 0 &&
                chosenRank >= 0 &&
                recRank < chosenRank &&
                downscaleEligibleChosen
              ) {
                const autoAccept = currentMetadata.auto_accept_recommendation === true
                let takeYes = false

                if (autoAccept) {
                  process.stderr.write(
                    color(
                      `Auto-accepting recommendation: downscale to /metta-${recommendedTier} (was ${currentWorkflow}, scored ${recommendedTier})`,
                      33,
                    ) + '\n',
                  )
                  takeYes = true
                } else {
                  const fileCount = score.signals.file_count
                  takeYes = await askYesNo(
                    color(
                      `Scored as ${recommendedTier} (${fileCount} files) -- collapse workflow to /metta-${recommendedTier}?`,
                      33,
                    ),
                    { defaultYes: false, jsonMode: json },
                  )
                }

                if (takeYes) {
                  // Load the target workflow graph and rebuild the artifact map.
                  const targetGraph = await ctx.workflowEngine.loadWorkflow(
                    recommendedTier,
                    [projectWorkflows, builtinWorkflows],
                  )
                  const existingArtifacts = currentMetadata.artifacts
                  const targetIds = new Set(targetGraph.artifacts.map(a => a.id))
                  const rebuilt: Record<string, ArtifactStatus> = {}

                  // Carry forward existing status for stages that remain in the target graph.
                  for (const artifact of targetGraph.artifacts) {
                    const prev = existingArtifacts[artifact.id]
                    rebuilt[artifact.id] = prev ?? 'pending'
                  }

                  // Carry forward non-target stages only when they are past the
                  // 'pending'/'ready' state (in_progress, complete, failed, skipped),
                  // i.e. preserve user work. Drop unstarted planning artifacts.
                  for (const [id, status] of Object.entries(existingArtifacts)) {
                    if (targetIds.has(id)) continue
                    if (status === 'pending' || status === 'ready') {
                      if (DROPPABLE_PLANNING_ARTIFACTS.has(id)) continue
                    }
                    rebuilt[id] = status
                  }

                  await ctx.artifactStore.updateChange(changeName, {
                    workflow: recommendedTier,
                    artifacts: rebuilt,
                  })
                  activeGraph = targetGraph
                } else {
                  // No path / non-TTY: informational banner only.
                  const banner = renderBanner(score, currentWorkflow)
                  if (banner) {
                    process.stderr.write(banner + '\n')
                    bannerEmitted = true
                  }
                }
              }

              // Upscale branch: recommendation is a strictly higher tier.
              if (recRank >= 0 && chosenRank >= 0 && recRank > chosenRank) {
                // Hard cap: full-tier upscale is not yet supported. Emit an
                // advisory to stderr and skip the prompt entirely.
                if (recommendedTier === 'full') {
                  process.stderr.write(
                    color(
                      'Advisory: scored full -- upscale to full is not yet supported; consider /metta-propose --workflow standard',
                      33,
                    ) + '\n',
                  )
                } else {
                  const autoAccept = currentMetadata.auto_accept_recommendation === true
                  let takeYes = false

                  if (autoAccept) {
                    process.stderr.write(
                      color(
                        `Auto-accepting recommendation: upscale to /metta-${recommendedTier} (was ${currentWorkflow}, scored ${recommendedTier})`,
                        33,
                      ) + '\n',
                    )
                    takeYes = true
                  } else {
                    const fileCount = score.signals.file_count
                    takeYes = await askYesNo(
                      color(
                        `Scored as ${recommendedTier} (${fileCount} files) -- promote workflow to /metta-${recommendedTier}?`,
                        33,
                      ),
                      { defaultYes: false, jsonMode: json },
                    )
                  }

                  if (takeYes) {
                    // Load the target workflow graph and diff against the
                    // current artifact map: insert any missing stages as
                    // 'pending'; preserve all existing statuses.
                    const targetGraph = await ctx.workflowEngine.loadWorkflow(
                      recommendedTier,
                      [projectWorkflows, builtinWorkflows],
                    )
                    const existingArtifacts = currentMetadata.artifacts
                    const rebuilt: Record<string, ArtifactStatus> = { ...existingArtifacts }
                    for (const artifact of targetGraph.artifacts) {
                      if (!(artifact.id in rebuilt)) {
                        rebuilt[artifact.id] = 'pending'
                      }
                    }

                    await ctx.artifactStore.updateChange(changeName, {
                      workflow: recommendedTier,
                      artifacts: rebuilt,
                    })
                    activeGraph = targetGraph
                  } else if (!bannerEmitted) {
                    // No path / non-TTY: informational banner only (unless the
                    // downscale branch already emitted one, which cannot happen
                    // here since the branches are mutually exclusive, but the
                    // guard keeps the invariant explicit).
                    const banner = renderBanner(score, currentWorkflow)
                    if (banner) {
                      process.stderr.write(banner + '\n')
                      bannerEmitted = true
                    }
                  }
                }
              }
            }
          } catch {
            // Scoring / downscale is advisory-only and must not block the complete command.
          }
        }

        // Post-implementation scoring and upscale prompt.
        // Reads summary.md (if present) and re-scores the change against its
        // actual realized file count. Persists `actual_complexity_score`
        // unconditionally (this field is always authoritative, unlike the
        // intent-time `complexity_score` which is write-once).
        if (artifactId === 'implementation') {
          try {
            const summaryExists = await ctx.artifactStore.artifactExists(changeName, 'summary.md')
            if (summaryExists) {
              const summaryMd = await ctx.artifactStore.readArtifact(changeName, 'summary.md')
              const score = scoreFromSummaryFiles(summaryMd)

              if (score !== null) {
                // Always persist -- unlike `complexity_score`, this field is
                // authoritative and may be rewritten.
                await ctx.artifactStore.updateChange(changeName, { actual_complexity_score: score })

                const currentMetadata = await ctx.artifactStore.getChange(changeName)
                const recommendedTier = score.recommended_workflow
                const currentWorkflow = currentMetadata.workflow
                const recRank = tierRank(recommendedTier)
                const chosenRank = tierRank(currentWorkflow)

                // Only act when the recomputed tier strictly exceeds the current
                // workflow tier. Downscale and same-tier cases are no-ops here.
                if (recRank >= 0 && chosenRank >= 0 && recRank > chosenRank) {
                  const fileCount = score.signals.file_count

                  // Hard cap: full-tier post-impl upscale is not yet supported.
                  if (recommendedTier === 'full') {
                    process.stderr.write(
                      color(
                        'Advisory: implementation scored full -- promotion to full is not yet supported; consider manually restarting as /metta-propose --workflow standard',
                        33,
                      ) + '\n',
                    )
                  } else {
                    const autoAccept = currentMetadata.auto_accept_recommendation === true
                    let takeYes = false

                    if (autoAccept) {
                      process.stderr.write(
                        color(
                          `Auto-accepting recommendation: post-impl upscale to /metta-${recommendedTier}`,
                          33,
                        ) + '\n',
                      )
                      takeYes = true
                    } else {
                      takeYes = await askYesNo(
                        color(
                          `Implementation touched ${fileCount} files -- promote to /metta-${recommendedTier} and retroactively author stories + spec?`,
                          33,
                        ),
                        { defaultYes: false, jsonMode: json },
                      )
                    }

                    if (takeYes) {
                      // Yes path: update workflow + mark stories/spec pending
                      // unless they already exist and are complete.
                      const existingArtifacts = currentMetadata.artifacts
                      const rebuilt: Record<string, ArtifactStatus> = { ...existingArtifacts }
                      for (const retroId of ['stories', 'spec'] as const) {
                        const prev = existingArtifacts[retroId]
                        if (prev === 'complete') continue
                        rebuilt[retroId] = 'pending'
                      }

                      await ctx.artifactStore.updateChange(changeName, {
                        workflow: recommendedTier,
                        artifacts: rebuilt,
                      })

                      // Swap the active graph so the downstream getNext step
                      // operates on the upscaled workflow shape.
                      activeGraph = await ctx.workflowEngine.loadWorkflow(
                        recommendedTier,
                        [projectWorkflows, builtinWorkflows],
                      )

                      // Directive goes to stdout so automation can observe it.
                      console.log(
                        `Post-impl upscale accepted. Run: metta instructions stories --change ${changeName}  then  metta instructions spec --change ${changeName}. Verification resumes after both are complete.`,
                      )
                    } else {
                      // No path / non-TTY: emit warning, leave workflow alone.
                      process.stderr.write(
                        color(
                          `Warning: this change touched ${fileCount} files -- ${recommendedTier} workflow was recommended; finalize will proceed on ${currentWorkflow}`,
                          33,
                        ) + '\n',
                      )
                    }
                  }
                }
              }
            }
          } catch {
            // Post-implementation scoring is advisory-only and must not block the complete command.
          }
        }

        // Determine next artifact
        const updatedMetadata = await ctx.artifactStore.getChange(changeName)
        const pendingArtifacts = Object.entries(updatedMetadata.artifacts)
          .filter(([_, status]) => status === 'pending' || status === 'ready')
          .map(([id]) => id)

        // Map artifact to agent name for banner
        const artifactAgentMap: Record<string, string> = {
          intent: 'proposer', stories: 'product', spec: 'specifier', research: 'researcher',
          design: 'architect', tasks: 'planner', implementation: 'executor', verification: 'verifier',
        }

        // Mark next artifact as ready
        if (pendingArtifacts.length > 0) {
          const next = ctx.workflowEngine.getNext(activeGraph, updatedMetadata.artifacts)

          for (const artifact of next) {
            await ctx.artifactStore.markArtifact(changeName, artifact.id, 'ready')
          }

          const nextIds = next.map(a => a.id)

          // Always print colored banner to stderr (visible even in --json mode)
          process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
          if (nextIds.length > 0) {
            const nextAgent = artifactAgentMap[nextIds[0]] ?? 'executor'
            process.stderr.write(`Next: ${agentBanner(nextAgent, nextIds.join(', '))}\n`)
          }

          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: nextIds,
              next_agent: nextIds.length > 0 ? `metta-${artifactAgentMap[nextIds[0]] ?? 'executor'}` : null,
              next_command: nextIds.length > 0 ? `metta instructions ${nextIds[0]} --json --change ${changeName}` : null,
              all_complete: false,
            })
          } else {
            console.log(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`))
            if (nextIds.length > 0) {
              const nextAgent = artifactAgentMap[nextIds[0]] ?? 'executor'
              console.log(`Next: ${agentBanner(nextAgent, nextIds.join(', '))}`)
              console.log(`Run: metta instructions ${nextIds[0]} --change ${changeName}`)
            }
          }
        } else {
          process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
          process.stderr.write(color('All artifacts complete!', 32) + '\n')

          if (json) {
            outputJson({
              completed: artifactId,
              change: changeName,
              next: [],
              next_command: `metta finalize --change ${changeName}`,
              all_complete: true,
            })
          } else {
            console.log(`Next: metta finalize --change ${changeName}`)
          }
        }
        // Auto-commit all spec changes (artifacts + .metta.yaml state)
        try {
          const changePath = join('spec', 'changes', changeName)
          await execAsync('git', ['add', changePath], { cwd: ctx.projectRoot })
          await execAsync('git', ['diff', '--cached', '--quiet'], { cwd: ctx.projectRoot }).catch(async () => {
            await execAsync('git', ['commit', '-m', `docs(${changeName}): complete ${artifactId}`], { cwd: ctx.projectRoot })
          })
        } catch {
          // Git not available or nothing to commit
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'complete_error', message } }) } else { console.error(`Complete failed: ${message}`) }
        process.exit(4)
      }
    })
}
