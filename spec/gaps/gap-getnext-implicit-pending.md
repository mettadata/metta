# Gap: getNext excludes artifacts with implicit pending status

**File:** `src/workflow/workflow-engine.ts` — `getNext` method
**Type:** Behavior without test / potential bug

## Description

`getNext` filters artifacts using:

```ts
if (status !== 'pending' && status !== 'ready') return false
```

When an artifact ID is absent from the `statuses` map, `statuses[artifact.id]` is `undefined`. The condition `undefined !== 'pending'` is `true` and `undefined !== 'ready'` is `true`, so the artifact is **excluded** from results.

Meanwhile, `getStatus` explicitly defaults missing artifacts to `'pending'`:

```ts
status: statuses[artifact.id] ?? 'pending'
```

This creates an inconsistency: `getStatus` reports an absent artifact as `pending` (actionable), but `getNext` would not return it as a candidate.

## Impact

A caller that initializes a change with an empty statuses map (before recording any artifact statuses) would receive an empty result from `getNext`, even for root artifacts with no dependencies. The change would appear blocked with no available next step.

## Expected Behavior

An artifact absent from `statuses` SHOULD be treated as `'pending'` by `getNext`, consistent with `getStatus`. The filter condition should be:

```ts
const status = statuses[artifact.id] ?? 'pending'
if (status !== 'pending' && status !== 'ready') return false
```

## Missing Test

There is no test covering the case where an artifact is absent from the statuses map and `getNext` is called. All existing `getNext` tests supply explicit status values for every artifact in the workflow.

## Recommended Fix

Apply the `?? 'pending'` default in `getNext` and add a test scenario:

**Given** a workflow with a root artifact `a` (no deps)
**And** an empty statuses map `{}`
**When** `getNext` is called
**Then** `a` MUST be returned (it is implicitly pending with no unmet deps)
