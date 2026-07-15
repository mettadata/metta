# fix-finalize-spec-merge-pipeline-hardening — User Stories

## US-1: Explicit capability targeting when authoring a delta spec

**As a** change author writing a delta spec for an existing capability
**I want to** be shown the existing capabilities under `spec/specs/` and explicitly choose the merge target (or explicitly confirm a net-new capability) before the spec artifact is generated
**So that** my delta merges into the capability I actually intended, instead of the merge target being silently inferred from a pre-filled H1 I may never have edited
**Priority:** P1
**Independent Test Criteria:** Running `metta instructions spec` for a change produces instructions/template output that lists the existing capability slugs from `spec/specs/` and requires an explicit target selection step, and the generated spec artifact no longer carries the change slug as an implicit default merge target.

**Acceptance Criteria:**
- **Given** a project with existing capabilities under `spec/specs/` **When** the author runs `metta instructions spec` for an active change **Then** the generated instructions surface the set of existing capability names and direct the author to select one or explicitly declare a net-new capability before authoring the delta
- **Given** the spec artifact template is rendered for a change named `my-change-slug` **When** the author inspects the generated artifact scaffold **Then** the merge target is an explicit, separately-authored field or decision rather than solely the H1 pre-filled with `my-change-slug`
- **Given** an author selects an existing capability as the target **When** the delta spec is completed and later merged **Then** the merge applies to that capability's `spec/specs/<capability>/spec.md` and no new capability folder is created

---

## US-2: `metta complete` refuses to silently mint a junk capability

**As a** change author completing a spec artifact
**I want to** have `metta complete` refuse (or demand explicit confirmation) when the resolved merge target equals the change's own slug and no such capability exists
**So that** an unedited default H1 can no longer silently create a landfill capability folder that pollutes `spec/specs/` and the generated CLAUDE.md capability table
**Priority:** P1
**Independent Test Criteria:** Running `metta complete spec` on an ADDED-only delta whose resolved capability slug equals the change slug, where no `spec/specs/<change-slug>/` folder exists, exits non-zero with a message naming the unrecognized target, and no new folder appears under `spec/specs/`.

**Acceptance Criteria:**
- **Given** an ADDED-only delta spec whose resolved capability slug equals the change's own slug and no matching capability folder exists **When** the author runs `metta complete spec` without explicit new-capability confirmation **Then** the command exits non-zero, names the unrecognized/unconfirmed target, and creates no folder under `spec/specs/`
- **Given** the author has explicitly confirmed a net-new capability per the authoring flow **When** `metta complete spec` runs **Then** the completion succeeds and the intended new capability is recorded as the merge target
- **Given** a delta spec containing MODIFIED, REMOVED, or RENAMED operations targeting a nonexistent capability **When** `metta complete spec` runs **Then** the existing hard-fail behavior is preserved (non-zero exit, no writes)

---

## US-3: Finalize refuses to archive a change with incomplete artifacts

**As a** developer shipping a change through `metta finalize`
**I want to** have finalize check every workflow-required artifact's completion state before doing anything else and refuse to proceed when any is not `complete`, listing the incomplete ones
**So that** a change whose verification (or any other artifact) was never formally accepted cannot be archived and reported as successfully shipped
**Priority:** P1
**Independent Test Criteria:** Running `metta finalize` on a change whose metadata shows an artifact in a non-`complete` state (e.g. verification `ready`) exits non-zero with output listing the incomplete artifact(s) by name, and the change is neither archived nor spec-merged.

**Acceptance Criteria:**
- **Given** a change whose `metadata.artifacts` contains at least one workflow-required artifact not in `complete` state **When** `metta finalize` runs **Then** it returns a distinct, clearly labeled failure (mapped to a non-zero CLI exit) listing each incomplete artifact before any gates run
- **Given** the completeness check fails **When** the finalize run ends **Then** no archiving has occurred, no spec merge has been written, and the change remains in its prior state so the author can complete the missing artifacts
- **Given** all workflow-required artifacts are `complete` **When** `metta finalize` runs **Then** the completeness check passes and finalize proceeds to gates and merge as normal

---

## US-4: Trivial workflow's verification contract matches instructed behavior

**As a** developer running a trivial-tier change end to end
**I want to** have the trivial workflow's verification stage declare only artifacts the flow actually instructs an agent to write (or have the instructions actually direct writing `summary.md`)
**So that** `metta complete verification` succeeds predictably on trivial changes instead of failing on a `summary.md` nothing ever told anyone to produce
**Priority:** P2
**Independent Test Criteria:** Following the trivial workflow's verification-stage instructions as written and then running `metta complete verification` exits zero — the stage's `generates` declaration in `src/templates/workflows/trivial.yaml` and the instructed outputs agree.

**Acceptance Criteria:**
- **Given** the trivial workflow template as shipped **When** its verification stage's `generates` list is compared against what the trivial-tier verification instructions direct an agent to write **Then** the two agree exactly (either `summary.md` is dropped from `generates` or the instructions explicitly direct writing it)
- **Given** a trivial-tier change whose verification stage was executed per the instructions **When** the author runs `metta complete verification` **Then** the command exits zero and the verification artifact transitions to `complete`
- **Given** the corrected contract **When** `metta finalize` runs on a fully-executed trivial change **Then** the US-3 completeness gate passes without manual artifact patching

---

## US-5: Re-merging an ADDED delta does not duplicate requirements

**As a** developer retrying finalize after an earlier attempt
**I want to** have the spec merger's ADDED path check whether a requirement section of the same name already exists in the capability spec and no-op (or surface a conflict) instead of appending again
**So that** retried finalizes cannot multiply requirements in living specs the way `adaptive-workflow-tier-selection` was quadruplicated from 13 to 52 headings
**Priority:** P1
**Independent Test Criteria:** Applying the same ADDED delta twice against a capability spec (e.g. via two `metta finalize` attempts or a direct merger test) leaves exactly one `## Requirement:` section with that name in `spec/specs/<capability>/spec.md`, with the second application either no-opping or reporting a conflict.

**Acceptance Criteria:**
- **Given** a capability spec that already contains a requirement section with a given name **When** an ADDED delta for that same requirement name is applied **Then** the merger detects the existing section (consistent with the MODIFIED/RENAMED/REMOVED lookup) and does not append a duplicate
- **Given** the duplicate-detection path triggers **When** the merge result is reported **Then** it is surfaced as a no-op or an explicit conflict, never as a silent second append
- **Given** a change that itself created the capability (so no `base_versions` entry exists) **When** its finalize is retried **Then** the idempotency check still prevents duplication despite the base-version conflict guard being unavailable

---

## US-6: Gate failure during finalize leaves living specs untouched

**As a** developer whose finalize run fails a quality gate
**I want to** have finalize either defer spec-merge disk writes until after gates pass or roll back the merge on gate failure
**So that** a failed finalize leaves `spec/specs/` exactly as it was, and retrying finalize cannot compound partially-applied merge output
**Priority:** P1
**Independent Test Criteria:** Running `metta finalize` on a change configured with a failing gate exits non-zero, and a diff of `spec/specs/` before and after the failed run shows no changes; a subsequent successful finalize produces exactly one copy of the delta's content.

**Acceptance Criteria:**
- **Given** a change whose finalize run will fail a quality gate **When** `metta finalize` runs and the gate fails **Then** the command exits non-zero and no spec-merge content from this change is present on disk under `spec/specs/`
- **Given** a finalize attempt that failed at gates **When** the author fixes the gate issue and reruns `metta finalize` **Then** the merge applies cleanly with each delta requirement appearing exactly once in the target capability spec
- **Given** finalize succeeds end to end **When** the run completes **Then** the spec merge is written to disk exactly once, after the gates have passed (or an equivalent rollback guarantee makes a mid-run failure leave no partial write)
