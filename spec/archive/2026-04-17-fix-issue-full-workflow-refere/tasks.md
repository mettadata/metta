# Tasks: fix-issue-full-workflow-refere

## Batch 1: Create three stub templates (all different files — parallel)

### Task 1.1: Create domain-research.md
- **Files:** `src/templates/artifacts/domain-research.md`
- **Action:** Write a new markdown stub matching the existing template style. H1 must be `# Domain Research: {change_name}`. H2 sections in this exact order: `## Domain Overview`, `## Competitive Landscape`, `## Technology Landscape`, `## Key Findings`, `## Implications for Intent`. Each section body is a single `{snake_case_placeholder}` line.
- **Verify:** `test -f src/templates/artifacts/domain-research.md && grep -c '^## ' src/templates/artifacts/domain-research.md` returns exactly `5`.
- **Done:** File exists and `grep '^## '` lists the five specified headers in order.

### Task 1.2: Create architecture.md
- **Files:** `src/templates/artifacts/architecture.md`
- **Action:** H1: `# Architecture: {change_name}`. H2 sections in order: `## Architecture Overview`, `## Component Breakdown`, `## Interfaces`, `## State & Data Flow`, `## Deployment Topology`, `## Risks`. Each section body is a single `{snake_case_placeholder}` line.
- **Verify:** `grep -c '^## ' src/templates/artifacts/architecture.md` returns `6`.
- **Done:** File exists and `grep '^## '` lists the six specified headers in order.

### Task 1.3: Create ux-spec.md
- **Files:** `src/templates/artifacts/ux-spec.md`
- **Action:** H1: `# UX Spec: {change_name}`. H2 sections in order: `## User Goals`, `## Key Flows`, `## Screens & States`, `## Components & Interactions`, `## Accessibility`, `## Visual Tone`. Each section body is a single `{snake_case_placeholder}` line.
- **Verify:** `grep -c '^## ' src/templates/artifacts/ux-spec.md` returns `6`.
- **Done:** File exists and `grep '^## '` lists the six specified headers in order.

---

## Batch 2: Build verification (single task — sequential)

### Task 2.1: Rebuild + confirm dist copy
- **Files:** `package.json` (no change), `dist/templates/artifacts/` (produced by build)
- **Action:** Run `npm run build`. Confirm `dist/templates/artifacts/` contains `domain-research.md`, `architecture.md`, and `ux-spec.md` after build completes.
- **Verify:** `ls dist/templates/artifacts/{domain-research,architecture,ux-spec}.md` lists all three without error.
- **Done:** All three files present under `dist/templates/artifacts/` with size > 0.

---

## Batch 3: Test suite (single task — sequential)

### Task 3.1: Run full gates
- **Files:** none (verification only)
- **Action:** `npx tsc --noEmit && npm test`
- **Verify:** Both commands exit 0.
- **Done:** Zero TypeScript errors, zero test failures.
