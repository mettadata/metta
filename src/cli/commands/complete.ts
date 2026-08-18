import { Command } from 'commander'
import { createCliContext, outputJson, color, agentBanner, askYesNo, askYesNoDetailed, getErrorMessage, resolveChangeRoot, resolveMainCheckoutRoot } from '../helpers.js'
import { compareMainTree, MainTreeContaminationError } from '../../util/git-tree-baseline.js'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseStories, StoriesParseError } from '../../specs/stories-parser.js'
import { validateFulfillsRefs } from '../../stories/story-validator.js'
import { parseSpec, parseDeltaSpec } from '../../specs/spec-parser.js'
import { readFile } from 'node:fs/promises'
import { toSlug, assertSafeSlug } from '../../util/slug.js'
import { scoreFromIntentImpact, scoreFromSummaryFiles, isScorePresent, renderBanner } from '../../complexity/index.js'
import { parseTasks, markTaskComplete } from '../../planning/index.js'
import { SpecTargetError } from '../../finalize/spec-merger.js'
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

/**
 * Strip C0 control characters and DEL from a string destined for the
 * terminal, so crafted filenames cannot inject escape sequences into
 * human-readable output. JSON output is escape-safe by construction and
 * keeps raw values.
 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '')
}

/**
 * Best-effort stamp of `artifact_timings[artifactId].completed` on the
 * change's metadata. Preserves any existing `started` value. Never throws
 * into the completion path — instrumentation MUST NOT block workflow.
 */
async function stampArtifactCompleted(
  ctx: ReturnType<typeof createCliContext>,
  changeName: string,
  artifactId: string,
): Promise<void> {
  try {
    const meta = await ctx.artifactStore.getChange(changeName)
    const timings = { ...(meta.artifact_timings ?? {}) }
    const existing = timings[artifactId] ?? {}
    timings[artifactId] = { ...existing, completed: new Date().toISOString() }
    await ctx.artifactStore.updateChange(changeName, { artifact_timings: timings })
  } catch (err) {
    process.stderr.write(
      `Warning: failed to record completion timestamp for ${artifactId}: ${getErrorMessage(err)}\n`,
    )
  }
}

// Confirmation marker for a delta spec that deliberately creates a net-new
// capability. Must occupy the first non-blank line after the delta's H1.
const NEW_CAPABILITY_MARKER = /^<!--\s*new-capability\s*-->\s*$/

/**
 * Scan the raw delta content for the `<!-- new-capability -->` marker: find
 * the first line starting with `#`, then test the next non-blank line against
 * the marker regex. Deliberately operates on raw lines, never on
 * `parseDeltaSpec`'s AST — remark's HTML-comment nodes fall through the delta
 * parser untouched, so a parsed-structure check would never see the marker.
 */
function hasNewCapabilityMarker(raw: string): boolean {
  const lines = raw.split('\n')
  const h1Index = lines.findIndex(line => line.startsWith('#'))
  if (h1Index === -1) return false
  for (let i = h1Index + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    return NEW_CAPABILITY_MARKER.test(lines[i])
  }
  return false
}

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

        // Slug-validate the change name before any store lookup or path join
        // built from it (matches context.ts) — a '../..'-shaped --change must
        // fail fast instead of traversing outside the spec tree.
        assertSafeSlug(changeName, 'change name')

        // Verify the artifact file exists
        const metadata = await ctx.artifactStore.getChange(changeName)
        if (!(artifactId in metadata.artifacts)) {
          throw new Error(`Artifact '${artifactId}' not in workflow. Available: ${Object.keys(metadata.artifacts).join(', ')}`)
        }

        // Change-scoped paths — gate reads, the capability spec existence
        // check, and the auto-commit target — root at the checkout hosting
        // the change: the worktree checkout for worktree-hosted changes
        // (a worktree carries its own full spec/ tree), the project root
        // otherwise. Workflow loading below stays main-root-anchored.
        const changeRoot = resolveChangeRoot(ctx.projectRoot, metadata)

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
            const storiesPath = join(changeRoot, 'spec', 'changes', changeName, generates)
            try {
              const stories = await parseStories(storiesPath)
              const specPath = join(changeRoot, 'spec', 'changes', changeName, 'spec.md')
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
            const specPath = join(changeRoot, 'spec', 'changes', changeName, generates)
            const deltaContent = await readFile(specPath, 'utf8')
            const deltaSpec = parseDeltaSpec(deltaContent)
            const capabilityName = toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))
            const capSpecPath = join(changeRoot, 'spec', 'specs', capabilityName, 'spec.md')
            const capExists = existsSync(capSpecPath)
            // Capability-target refusal gate: an H1 that still resolves to the
            // change's own slug, with no existing capability of that name,
            // must be explicitly confirmed as net-new via the marker —
            // otherwise every finalize lands its deltas in a fresh
            // change-slug-named capability by accident. Throws before
            // markArtifact, so no file or folder is created.
            if (
              capabilityName === toSlug(changeName) &&
              !capExists &&
              !hasNewCapabilityMarker(deltaContent)
            ) {
              throw new SpecTargetError(
                `Delta spec's merge target '${capabilityName}' matches this change's own slug and no such capability exists yet. ` +
                `Add '<!-- new-capability -->' directly under the H1 to confirm creating a new capability, or change the H1 to name an existing capability (see 'existing_specs' in the spec-authoring instructions).`,
              )
            }
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

        // Pre-complete main-tree contamination gate (layer 3). Worktree-hosted
        // changes only: `resolveMainCheckoutRoot` returns null for non-worktree
        // changes, disengaging the gate entirely. Sits OUTSIDE the
        // `if (!isWildcard)` block above — implementation generates `**/*`,
        // a wildcard, so an in-branch gate would never run. Detection only:
        // the gate performs a single `git status` read against the main
        // checkout — never checkout/reset/stash.
        if (artifactId === 'implementation') {
          const mainRoot = await resolveMainCheckoutRoot(ctx.projectRoot, changeName, metadata)
          if (mainRoot !== null) {
            // Fail-open on infrastructure faults: only a positive
            // contamination detection (MainTreeContaminationError thrown
            // below) may block completion. A failing git invocation inside
            // the compare (missing/corrupted .git, git absent) is a
            // check-infrastructure failure, not evidence of dirt — warn and
            // proceed, consistent with the capture (warn-and-continue) and
            // ship (fail-open skip) layer-3 surfaces.
            let cmp: Awaited<ReturnType<typeof compareMainTree>> | null = null
            try {
              cmp = await compareMainTree(mainRoot, changeName)
            } catch (gateErr) {
              process.stderr.write(
                `Warning: main-checkout cleanliness check skipped: ${getErrorMessage(gateErr)}\n`,
              )
            }
            if (cmp === null) {
              // Check skipped — warning already emitted above.
            } else if (!cmp.hasBaseline) {
              // No baseline recorded (feature shipped mid-flight, scratch
              // wiped, or main_root mismatch): dirt cannot be attributed —
              // warn and pass, never a hard failure on absence.
              process.stderr.write(
                `Warning: no main-tree baseline recorded for '${changeName}' — cannot attribute main-checkout dirt; skipping contamination check.\n`,
              )
            } else if (cmp.newDirt.length > 0) {
              // Lists ONLY the newly-dirty paths (+ XY status codes) —
              // pre-existing dirt never blocks and never appears here.
              // Control characters are stripped from this human-readable
              // listing (terminal-escape injection via crafted filenames);
              // the raw paths travel on the error's newDirt payload,
              // surfaced as `error.new_dirt` in --json mode.
              const listing = cmp.newDirt
                .map(e => `  [${e.status}] ${stripControlChars(e.path)}`)
                .join('\n')
              throw new MainTreeContaminationError(
                `Main checkout at ${mainRoot} accumulated new dirt during this worktree-hosted change:\n` +
                `${listing}\n` +
                `If these are your own edits, commit or stash them in the main checkout and re-run metta complete implementation.`,
                cmp.newDirt,
              )
            } else if (cmp.preExisting.length > 0) {
              process.stderr.write(
                `Warning: main checkout at ${mainRoot} has pre-existing dirt (${cmp.preExisting.length} path(s), recorded at baseline time) — not blocking completion.\n`,
              )
            }
          }
        }

        // Mark complete
        await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')

        // Stamp `artifact_timings[id].completed` (best-effort; never blocks
        // the completion path). Existing `started` value — if any — is
        // preserved. See spec `metta complete stamps artifact completed
        // timestamp` requirement.
        await stampArtifactCompleted(ctx, changeName, artifactId)

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
                // Non-interactive callers (no TTY, or --json) must never resolve
                // a workflow-collapsing decision via a silent default-Yes. This
                // is the same predicate askYesNo uses internally to decide
                // whether to prompt at all. See AutoDownscalePromptAtIntent.
                const nonInteractive = !process.stdin.isTTY || json
                let takeYes = false
                let acceptCause:
                  | 'auto_accept_recommendation'
                  | 'interactive explicit yes'
                  | 'interactive default-Yes'
                  | null = null

                if (autoAccept) {
                  // Sole sanctioned non-interactive Yes -- MUST stay first.
                  process.stderr.write(
                    color(
                      `Auto-accepting recommendation: downscale to /metta-${recommendedTier} (was ${currentWorkflow}, scored ${recommendedTier})`,
                      33,
                    ) + '\n',
                  )
                  takeYes = true
                  acceptCause = 'auto_accept_recommendation'
                } else if (nonInteractive) {
                  // Fail closed: never resolve a workflow-collapsing decision
                  // via default-Yes without a human present to confirm it.
                  takeYes = false
                } else {
                  const fileCount = score.signals.file_count
                  // Downscale defaults to Yes unless the workflow was explicitly
                  // locked (e.g. via --workflow); reached only when interactive.
                  // `jsonMode: json` is provably false here -- this branch is
                  // only reached when `nonInteractive` (`!TTY || json`) is
                  // false, so `json` is always false at this point. Passed
                  // through anyway to keep the call shape consistent with the
                  // other askYesNoDetailed/askYesNo call sites in this file.
                  const { value, viaDefault } = await askYesNoDetailed(
                    color(
                      `Scored as ${recommendedTier} (${fileCount} files) -- collapse workflow to /metta-${recommendedTier}?`,
                      33,
                    ),
                    { defaultYes: currentMetadata.workflow_locked !== true, jsonMode: json },
                  )
                  takeYes = value
                  if (value) {
                    acceptCause = viaDefault ? 'interactive default-Yes' : 'interactive explicit yes'
                  }
                }

                if (takeYes) {
                  // Narrow acceptCause to non-null at the type level before it
                  // is folded into the decision record's justification string.
                  // `takeYes` is only ever set true in lockstep with an
                  // `acceptCause` assignment above, so this branch is an
                  // invariant guard, not a reachable failure mode -- but a
                  // regression here must surface as a stderr advisory (via the
                  // enclosing catch), never as a silently-persisted
                  // "...: null" justification.
                  if (acceptCause === null) {
                    throw new Error('internal invariant violated: takeYes without acceptCause')
                  }
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

                  // Fold the decision record into the same atomic write as the
                  // workflow/artifacts rewrite -- a workflow collapse without a
                  // validated decision record MUST NOT occur (both-or-neither
                  // via StateStore.write's pre-persist safeParse). See ADR-3.
                  await ctx.artifactStore.updateChange(changeName, {
                    workflow: recommendedTier,
                    artifacts: rebuilt,
                    downscale_decision: {
                      from_tier: currentWorkflow,
                      to_tier: recommendedTier,
                      justification: `collapsed ${currentWorkflow} -> ${recommendedTier}: ${acceptCause}`,
                      timestamp: new Date().toISOString(),
                    },
                  })
                  activeGraph = targetGraph
                } else {
                  // No path: the change stays above its scored recommendation.
                  // Record an escalation so staying heavy is auditable
                  // (EscalationRecording). Justification is keyed by cause,
                  // with workflow_locked keeping precedence over the
                  // non-interactive fail-closed cause.
                  const justification = currentMetadata.workflow_locked === true
                    ? `kept ${currentWorkflow}: workflow_locked`
                    : nonInteractive
                      ? `kept ${currentWorkflow}: non-interactive fail-closed`
                      : `kept ${currentWorkflow}: declined downscale`
                  // Single-slot overwrite guard: `escalation` holds exactly one
                  // record, so a repeated `complete intent` run on the same
                  // from/to tier pair must not clobber an earlier run's
                  // justification (e.g. a deliberate interactive decline
                  // replaced by a later non-interactive fail-closed rerun).
                  // First record wins for a given tier pair; a genuinely
                  // different tier pair (or no existing record) still writes.
                  const existingEscalation = currentMetadata.escalation
                  const sameTierPairAlreadyRecorded =
                    existingEscalation !== undefined &&
                    existingEscalation.from_tier === recommendedTier &&
                    existingEscalation.to_tier === currentWorkflow
                  if (!sameTierPairAlreadyRecorded) {
                    await ctx.artifactStore.updateChange(changeName, {
                      escalation: {
                        from_tier: recommendedTier,
                        to_tier: currentWorkflow,
                        justification,
                        timestamp: new Date().toISOString(),
                      },
                    })
                  }
                  // Informational banner only.
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
          } catch (err) {
            // Scoring / downscale is advisory-only and must not block the
            // complete command -- but a failure here (e.g. the accept-path
            // updateChange after the "Auto-accepting recommendation..."
            // banner already printed) must not fail silently: the console
            // would otherwise claim a workflow collapse that never
            // persisted. Warn on stderr; keep the exit code untouched.
            process.stderr.write(
              `Advisory: workflow scoring step failed: ${getErrorMessage(err)}\n`,
            )
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

          // Tick tasks.md checkboxes; advisory-only — never block complete.
          try {
            const tasksExists = await ctx.artifactStore.artifactExists(changeName, 'tasks.md')
            if (tasksExists) {
              const tasksMd = await ctx.artifactStore.readArtifact(changeName, 'tasks.md')
              const parsed = parseTasks(tasksMd)
              let updated = tasksMd
              for (const task of parsed) {
                updated = markTaskComplete(updated, task.id)
              }
              if (updated !== tasksMd) {
                await ctx.artifactStore.writeArtifact(changeName, 'tasks.md', updated)
              }
            }
          } catch {
            // swallow
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

          if (json) {
            // In --json mode stdout carries the payload, so the human-readable
            // banner goes to stderr; in plain mode stdout gets the single copy.
            process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
            if (nextIds.length > 0) {
              const nextAgent = artifactAgentMap[nextIds[0]] ?? 'executor'
              process.stderr.write(`Next: ${agentBanner(nextAgent, nextIds.join(', '))}\n`)
            }
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
          if (json) {
            // Stderr banner only in --json mode (stdout is reserved for the payload)
            process.stderr.write(agentBanner(artifactAgentMap[artifactId] ?? 'executor', `${artifactId} complete`) + '\n')
            process.stderr.write(color('All artifacts complete!', 32) + '\n')
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
        // Auto-commit all spec changes (artifacts + .metta.yaml state). The
        // commit targets the checkout hosting the change — the worktree
        // branch for worktree-hosted changes — never the main checkout's
        // index when invoked from the main root.
        try {
          const changePath = join('spec', 'changes', changeName)
          await execAsync('git', ['add', changePath], { cwd: changeRoot })
          await execAsync('git', ['diff', '--cached', '--quiet'], { cwd: changeRoot }).catch(async () => {
            await execAsync('git', ['commit', '-m', `docs(${changeName}): complete ${artifactId}`], { cwd: changeRoot })
          })
        } catch {
          // Git not available or nothing to commit
        }
      } catch (err) {
        const message = getErrorMessage(err)
        // Differentiate the layer-3 contamination gate via instanceof so
        // automation can distinguish it without a new exit code (D6).
        const type = err instanceof MainTreeContaminationError ? 'main_tree_contamination' : 'complete_error'
        // Contamination errors carry the raw newly-dirty entries in the JSON
        // payload (the message's listing is control-char-stripped for
        // terminal safety, so machine consumers read `new_dirt` for paths).
        const errorPayload = err instanceof MainTreeContaminationError
          ? { code: 4, type, message, new_dirt: err.newDirt }
          : { code: 4, type, message }
        if (json) { outputJson({ error: errorPayload }) } else { console.error(`Complete failed: ${message}`) }
        process.exit(4)
      }
    })
}
