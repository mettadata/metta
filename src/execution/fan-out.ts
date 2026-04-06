/**
 * Fan-out pattern for multi-perspective parallel work.
 * Used for reviews, research, brainstorming where multiple agents
 * work on the same context from different angles.
 */

export interface FanOutTask {
  id: string
  agent: string
  persona: string
  task: string
  context: string
}

export interface FanOutResult {
  id: string
  agent: string
  status: 'complete' | 'failed'
  output: string
  duration_ms: number
}

export interface FanOutPlan {
  tasks: FanOutTask[]
  mergeStrategy: 'concat' | 'structured' | 'vote'
}

/**
 * Create a fan-out plan for multi-perspective review.
 * Each agent gets the same context but different instructions.
 */
export function createReviewFanOut(
  changeName: string,
  changedFiles: string[],
  context: string,
): FanOutPlan {
  return {
    tasks: [
      {
        id: 'correctness',
        agent: 'metta-reviewer',
        persona: 'You are a correctness reviewer. Check that the code does what the spec says. Look for logic errors, off-by-one bugs, and unhandled edge cases.',
        task: `Review these files for correctness: ${changedFiles.join(', ')}`,
        context,
      },
      {
        id: 'security',
        agent: 'metta-reviewer',
        persona: 'You are a security reviewer. Check for OWASP top 10, XSS, injection, unvalidated input, secrets in code, and unsafe patterns.',
        task: `Review these files for security: ${changedFiles.join(', ')}`,
        context,
      },
      {
        id: 'quality',
        agent: 'metta-reviewer',
        persona: 'You are a quality reviewer. Check for dead code, unused imports, naming inconsistency, duplication, missing error handling, and test gaps.',
        task: `Review these files for quality: ${changedFiles.join(', ')}`,
        context,
      },
    ],
    mergeStrategy: 'structured',
  }
}

/**
 * Create a fan-out plan for research exploration.
 * Each agent explores a different approach.
 */
export function createResearchFanOut(
  description: string,
  context: string,
  approaches: string[],
): FanOutPlan {
  return {
    tasks: approaches.map((approach, i) => ({
      id: `approach-${i + 1}`,
      agent: 'metta-researcher',
      persona: `You are evaluating the "${approach}" approach. Be thorough about its pros, cons, complexity, and how it fits with the existing codebase.`,
      task: `Evaluate "${approach}" for: ${description}`,
      context,
    })),
    mergeStrategy: 'structured',
  }
}

/**
 * Merge fan-out results into a single summary.
 */
export function mergeFanOutResults(
  results: FanOutResult[],
  strategy: FanOutPlan['mergeStrategy'],
): string {
  const successful = results.filter(r => r.status === 'complete')
  const failed = results.filter(r => r.status === 'failed')

  const sections: string[] = []

  if (failed.length > 0) {
    sections.push(`## Failed (${failed.length})`)
    for (const f of failed) {
      sections.push(`- ${f.agent}/${f.id}: failed`)
    }
    sections.push('')
  }

  switch (strategy) {
    case 'concat':
      for (const r of successful) {
        sections.push(`## ${r.agent} — ${r.id}`)
        sections.push(r.output)
        sections.push('')
      }
      break

    case 'structured':
      sections.push(`## Results (${successful.length} agents)`)
      sections.push('')
      for (const r of successful) {
        sections.push(`### ${r.id} (${r.agent}, ${r.duration_ms}ms)`)
        sections.push(r.output)
        sections.push('')
      }
      break

    case 'vote':
      sections.push(`## Votes (${successful.length} agents)`)
      sections.push('')
      for (const r of successful) {
        sections.push(`- **${r.id}**: ${r.output.split('\n')[0]}`)
      }
      break
  }

  return sections.join('\n')
}

/**
 * Generate the instructions for spawning parallel agents in Claude Code.
 * Returns the JSON structure the orchestrator skill should use.
 */
export function formatFanOutForSkill(plan: FanOutPlan): object {
  return {
    parallel: true,
    agents: plan.tasks.map(t => ({
      subagent_type: t.agent,
      description: `${t.id}: ${t.task.slice(0, 60)}`,
      prompt: `${t.persona}\n\n## Task\n${t.task}\n\n## Context\n${t.context}`,
    })),
    merge_strategy: plan.mergeStrategy,
  }
}
