# Research: warning-only approach (emit a yellow log on absent docs block)

## Approach

Leave both the schema and the finalizer guard logic unchanged. Add a warning emitted from `Finalizer.finalize()` Step 4 when `docsConfig` is undefined: print to stderr something like `warning: docs/changelog.md will not be regenerated; add 'docs:' to .metta/config.yaml to enable doc generation on finalize`. Do not regenerate any docs.

## Why this is tempting

- **Lowest blast radius**. No behavioral change. No diff in any user project's `docs/changelog.md`. No risk to existing test suites that may have implicitly depended on absent-block silent-skip.
- **Discovery aid**. Surfaces the gap so users learn the option exists.

## Why this is the wrong choice

1. **Does not deliver the requested feature.** The user's bug report (`spec/issues/finalize-stage-should-auto-update-docs-changelog-md.md`) is "finalize does not refresh docs/changelog.md". A warning telling them how to opt in does not refresh the changelog. We would close this issue without resolving it; the user would file the same complaint again or stop using metta.

2. **Still violates the original spec.** The 2026-04-06 docs-generate spec at `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241` requires the absent-block case to *default to and produce* output. A warning is not output.

3. **Adds noise to every finalize.** Until users add the block, every finalize emits the same warning. Once they do add it, they have to remember they did. Net result: noisy logs for users who did nothing wrong.

4. **Implies a self-perpetuating gap.** Telling users to "add `docs:` to your config" makes the absent-block case feel like the user's mistake, not the framework's. It enshrines the silent-skip as a feature rather than a bug.

## When this approach would be right

If the framework had committed to absent-block-equals-disabled as a documented invariant (e.g. via a published v1.0 doc) and removing that invariant would break enough users that we needed a deprecation cycle. None of those conditions hold:
- The behavior is undocumented (absent-block silent-skip is not mentioned in `docs/getting-started.md` or `spec/project.md`).
- The spec at `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241` actually asserts the opposite invariant.
- No user is on record relying on the silent-skip.

## Recommendation

Reject as a primary fix. A one-line note in the change summary mentioning that explicit opt-out is via `docs.generate_on: manual` covers any user who wants to suppress doc generation; that is sufficient discoverability without the noise of a permanent stderr warning.
