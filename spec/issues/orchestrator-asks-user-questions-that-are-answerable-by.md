# orchestrator asks user questions that are answerable by WebFetch on public documentation instead of fetching the docs itself

**Captured**: 2026-04-21
**Status**: logged
**Severity**: minor

## Symptom

The metta orchestrator pauses a change workflow to ask the user questions whose answers are available in public documentation (e.g. "does Claude Code skill frontmatter support `context: fork`?" is answered by `https://code.claude.com/docs/en/skills`). The user has to explicitly redirect the orchestrator to "search the doco online and work it out". Observed in change `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill` during the research → design transition: the orchestrator had verified research findings that depended on `context: fork`, couldn't confirm the feature existed from training data, and asked the user instead of fetching the public docs itself — despite having `WebFetch` and `WebSearch` tools available the entire time.

## Root Cause Analysis

The current skill definitions prescribe `WebSearch` usage in a narrow, specific context only: "technology-option grounding during Round 1 discovery" of `metta-propose` / `metta-quick` / `metta-init`. There is no general-purpose rule — in either `CLAUDE.md` or the skill definitions — that says "when a research-phase question has a deterministic answer in public documentation, the orchestrator should fetch it before asking the user". Absent such a rule, the orchestrator defaults to `AskUserQuestion` because every skill's discovery-phase instructions push interaction with the user. The behavior is an instruction-surface gap, not a model capability gap: `WebFetch` and `WebSearch` are already in several skills' `allowed-tools` lists, but their use is scoped narrowly to tech-option grounding, not to framework-behavior verification.

### Evidence

- `.claude/skills/metta-propose/SKILL.md:49` — WebSearch directive is scoped only to "technology options (libraries, frameworks, tools, ORMs, test runners, auth providers)" in Round 1 scope+architecture discovery.
- `.claude/skills/metta-fix-issues/SKILL.md` — no WebFetch/WebSearch reference anywhere; the research phase delegates to `metta-researcher` subagents whose prompts are ad-hoc, without an explicit instruction that "for framework-API questions, the subagent MUST fetch docs first".
- `CLAUDE.md` Metta Workflow section — no rule about proactive documentation research vs user questions.

## Candidate Solutions

1. **Add a general research-phase directive to CLAUDE.md Metta Workflow section.** One rule: "When a research-phase question has a deterministic answer in public documentation (framework API docs, library reference, language spec), use WebFetch/WebSearch to resolve it before asking the user. Only escalate to the user for subjective judgments — scope, cost, product direction." Highest leverage: affects every orchestrator session regardless of which skill is active. Tradeoff: adds length to CLAUDE.md; orchestrators still need judgment to decide what qualifies as "deterministic".

2. **Extend the orchestrator skill templates (`metta-propose`, `metta-fix-issues`, `metta-quick`, `metta-auto`) with an explicit research-phase rule.** Add a paragraph to each skill's research-related section: "If the research question is about an external framework/API/tool's documented behavior, the orchestrator MUST invoke WebFetch or WebSearch on the authoritative source before spawning a subagent or asking the user." More targeted than CLAUDE.md and closer to where the orchestrator's attention is focused during the workflow. Tradeoff: adds content to 4–5 skill templates; the rule must be maintained in multiple places; minor drift risk between CLAUDE.md and skill prose.

3. **Introduce a `metta-doc-researcher` subagent specialised for public-documentation lookups.** The orchestrator delegates every external-doc question to this agent; the agent's persona restricts it to WebFetch + WebSearch + citation, preventing it from asking the user. Structural separation — the orchestrator simply routes, the agent simply fetches. Tradeoff: extra agent to author, maintain, and spawn; adds latency and token overhead for simple fact lookups that the orchestrator could have resolved inline with one WebFetch call.
