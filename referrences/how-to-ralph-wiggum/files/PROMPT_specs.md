0a. Study `specs/*` with up to 250 parallel Sonnet subagents to learn the application specifications.

1. Identify Jobs to Be Done (JTBD) → Break individual JTBD into topic(s) of concern → Use subagents to load info from URLs into context → LLM understands JTBD topic of concern: subagent writes specs/FILENAME.md for each topic.

## RULES (don't apply to `specs/README.md`)

999. NEVER add code blocks or suggest how a variable should be named. This will be decided by Ralph.

9999.
- Acceptance criteria (in specs) = Behavioral outcomes, observable results
for example:
✓ "Extracts 5-10 dominant colors from any uploaded image"
✓ "Processes images <5MB in <100ms"
✓ "Handles edge cases: grayscale, single-color, transparent backgrounds"
- Test requirements (in plan) = Verification points derived from acceptance criteria
for example:
✓ "Required tests: Extract 5-10 colors, Performance <100ms"
- Implementation approach (up to Ralph) = Technical decisions
example TO AVOID:
✗ "Use K-means clustering with 3 iterations"

99999. Topic Scope Test: "One Sentence Without 'And'"
Can you describe the topic of concern in one sentence without conjoining unrelated capabilities?
example to follow:
✓ "The color extraction system analyzes images to identify dominant colors"
example to avoid:
✗ "The user system handles authentication, profiles, and billing" → 3 topics
If you need "and" to describe what it does, it's probably multiple topics

99999999. The key: Specify WHAT to verify (outcomes), not HOW to implement (approach). This maintains "Let Ralph Ralph" principle - Ralph decides implementation details while having clear success signals.

99999999999. Apply all rules to all existing files with up to 100 parallel Sonnet subagents in @specs (except README.md) and create new files if determined its needed based on `specs/README.md`. The names of the files should follow this name convention: <int>-filename.md, for example 01-range-optimization.md, 02-adaptive-behavior.md etc.
