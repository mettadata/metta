# Research: fix-metta-framework-parallelism-strengthen-skill-templates

## Decision

Two-part architecture:

1. **Skill-template wording**: rule-inversion (parallel unless named file conflict) + worked anti-example contrasting serial vs single-message multi-tool-call spawn. Abandon the "mandatory fill-in-the-blank scaffold" approach — its compliance risk is highest under the exact conditions where discipline collapses (high load, token pressure).
2. **CLI helper `metta tasks plan --change <name>`**: new `src/cli/commands/tasks.ts` with a `plan` subcommand mirroring the `gate.ts`/`backlog.ts`/`gaps.ts` multi-subcommand pattern. Pure wave algorithm in `src/planning/parallel-wave-computer.ts`. Algorithm is components-then-toposort: union-find on file-overlap → cluster DAG → Kahn's topological sort honoring `Depends on` directives → emit each cluster at its computed level.

### Approaches Considered

**A. Skill template wording:**

1. **Rule inversion + anti-example (selected)** — flip the default so parallel is the cheap choice and sequential requires naming a specific file conflict. Pair with a worked anti-example. Activates LLM pattern-avoidance more reliably than abstract rules.
2. Mandatory explicit self-check step — orchestrator lists each task/files/decision before spawning. Prose-enforced, can be skipped under load.
3. Fill-in-the-blank structural template — highest mechanical compliance if followed; highest compliance risk precisely when it matters most.

**B. Wave algorithm:**

1. Connected-components on file-overlap graph — ignores `Depends on` directives; places disjoint-file-but-dependent tasks into the same parallel wave → race.
2. Topological sort on explicit dependencies — ignores file-overlap; places same-file tasks into parallel waves → concurrent-write race.
3. **Components-then-toposort (selected)** — union-find on file overlap forms sequential clusters; Kahn's toposort on cluster DAG honors cross-cluster `Depends on`; each cluster's tasks emitted at its computed level. Satisfies both signals. ~120 LOC pure function.

**C. CLI surface:**

1. **New `src/cli/commands/tasks.ts` with `plan` subcommand (selected)** — matches existing multi-subcommand pattern (`gate.ts`, `backlog.ts`, `gaps.ts`). Registered between `registerStatusCommand` and `registerUpdateCommand` in `src/cli/index.ts`.
2. Inline in existing `plan.ts` — rejected; `plan.ts` serves artifact-workflow state, a different purpose. `--change` flag collision.
3. Flag on an existing command — rejected; spec literally reads `metta tasks plan`.

### Rationale

The failure mode is *not* ignorance of the parallelism rule — both SKILL.md templates already say "spawn in parallel." The failure mode is that sequential execution is *cheaper to produce* for an orchestrator defaulting to caution. Rule inversion raises the cost of the wrong choice relative to the right choice at the instruction layer. The CLI helper gives the orchestrator a copy-paste-ready plan, removing the cognitive cost of the analysis entirely.

The wave algorithm defaults to over-serialization (safe) while surfacing genuine parallelism across disjoint components. Missing `Files` fields are treated as file-disjoint (placed in earliest wave) rather than hard-failing — consistent with the "opportunistic parallelism" stance.

### Output format (human mode)

Globally-numbered waves separated by `--- Batch N ---` headers. Each wave line carries `[parallel]` or `[sequential]` annotation. Example orchestrator copy:

```
--- Batch 1 ---
Wave 1 [parallel]: Task 1.1, Task 1.2, Task 1.3, Task 1.4
--- Batch 2 ---
Wave 2 [parallel]: Task 2.1, Task 2.3
Wave 3 [sequential]: Task 2.2 (depends on 2.1), Task 2.4 (shares src/cli/helpers.ts with 2.3)
```

### JSON schema

```
{
  "change": string,
  "batches": [
    {
      "batch": number,
      "label": string,
      "waves": [
        { "wave": string, "mode": "parallel" | "sequential", "tasks": string[] }
      ]
    }
  ]
}
```

### Error codes

- Missing `tasks.md` → exit 4 with expected-path in message
- Missing `Files` field on a task → soft warning, treat as file-disjoint
- Dependency cycle → exit 4 with involved task IDs named
- All errors in `--json` mode use the `{ error: { code, type, message } }` envelope from `handleError()` in `helpers.ts`

### Artifacts Produced

- [Wave algorithm research](research-wave-algorithm.md)
- [Skill wording research](research-skill-wording.md)
- [CLI surface research](research-cli-surface.md)
