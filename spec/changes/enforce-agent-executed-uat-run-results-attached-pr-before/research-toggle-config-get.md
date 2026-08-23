# Research: toggle via guard-allowlisted `metta config get uat.enforce_on_ship --json`

## Approach

Ship-path skills resolve the `uat.enforce_on_ship` toggle at their post-finalize decision point by calling `metta config get uat.enforce_on_ship --json`, with `config get` added as a read-only allowed two-word form in both guard hook copies (`src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs`).

## How it works (with concrete file/line evidence)

**`config get` semantics** (`src/cli/commands/config.ts:37-66`):
- Loads config through `ctx.configLoader.load()` — i.e. through `ProjectConfigSchema.parse` — then walks the key with a dot-notation split (`key.split('.')`, lines 46-55), descending only through object values; any miss yields `undefined`.
- **Defaults ARE applied.** `ConfigLoader.load()` (`src/config/config-loader.ts:127-146`) coalesces a missing/empty `.metta/config.yaml` to `{}` via `loadYamlFile(...) ?? {}` and then runs `ProjectConfigSchema.parse(merged)`. So once `enforce_on_ship: z.boolean().default(true)` is added to `UatConfigSchema` (`src/schemas/project-config.ts:45-47`, currently only `enabled`), `config get uat.enforce_on_ship` returns `true` even when the key — or the whole `uat` block, or the whole config file — is absent from disk.
- **`--json` output shape:** `outputJson({ key, value })` (line 57). With the schema field present the output is `{"key":"uat.enforce_on_ship","value":true}` (or `false`). `--json` is a program-level Commander option (`src/cli/index.ts:61`) read via `program.opts().json`, so trailing placement works, matching the `metta status --json` idiom skills already use.
- **Exit codes:** 0 for any successful lookup **including a missing key** (missing key is not an error — non-JSON mode prints the string `undefined`, line 59); 4 only when config loading itself fails, e.g. malformed YAML or a Zod validation failure, emitting `{"error":{"code":4,"type":"config_error",...}}` (lines 61-65).
- **Missing-key JSON caveat:** `JSON.stringify` drops `undefined` properties, so a CLI build that predates the schema field emits `{"key":"uat.enforce_on_ship"}` with **no `value` field at all**. Skill wording must define "`value` absent or `true` → enforce" so a stale installed CLI fails toward enforcement, not silently opting out.

**Guard hook mechanics** (`src/templates/hooks/metta-guard-bash.mjs`, byte-identical to `.claude/hooks/metta-guard-bash.mjs` — verified by md5):
- Two-word allowed forms live in `ALLOWED_TWO_WORD` (lines 48-64), a `Map<sub, Set<third>>` consulted by `classify()` at lines 672-673. The change is one entry: `['config', new Set(['get'])]`, with a comment in the established style (cf. the `gaps`/`release` entries at lines 53-63).
- Tokenizer fit: `metta config get uat.enforce_on_ship --json` tokenizes to `sub='config'`, `third='get'` (lines 636-654); no bare `--` token, so the operand-terminator fail-close (line 669) never triggers. Chain-separator segmentation and env-prefix consumption are orthogonal and unaffected.
- **`config set` does NOT become reachable from untrusted contexts.** With only `get` in the allowed set, `config set` classifies through: not in `ALLOWED_TWO_WORD['config']`, not in `BLOCKED_SUBCOMMANDS` (lines 67-73), not in `BLOCKED_TWO_WORD` (lines 76-86) → `'unknown'` → fail-closed block (lines 981-991) for orchestrator and session-tier callers. Same for `config edit` and bare `metta config` (not in `ALLOWED_BARE`, line 96).
- **Fork-tier callers can already run `config get` (and `config set`) today with zero hook change.** In the offender scan, a trusted fork caller (`agent_type` starting `metta-`, line 684-686) short-circuits every non-Tier-1 invocation to accepted (lines 869-872). So metta-ship/propose/quick/auto/fix-issues (all fork-tier via `metta-skill-host`) are unblocked either way; the allowlist entry exists for exactly one consumer: **session-tier `metta-fix-gap`**. Today its call dies as follows: `classify` → `'unknown'`; token scope check computes key `'config'` (no `BLOCKED_TWO_WORD['config']` entry, lines 902-905); the fix-gap mint scope is `['fix-gap', 'complete', 'finalize']` (`.claude/hooks/metta-session-mint.mjs:36`) → `subcommand-not-in-scope` → blocked. The `ALLOWED_TWO_WORD` entry resolves this at the `classify` stage, before any credential is consulted — no mint-scope change needed (and a mint-scope route would be **wrong**: the Tier-2 scope key for `config set` is also bare `'config'`, so scoping `'config'` to fix-gap would authorize writes).
- Hook wiring: `.claude/settings.json:18` executes `.claude/hooks/metta-guard-bash.mjs` directly (source `.mjs`, not a `dist/` build product), so there is no compiled-artifact drift for this hook; the template↔deployed pair sync is enforced by `tests/template-deploy-sync.test.ts` (`{ name: 'hooks', src: 'src/templates/hooks', deployed: '.claude/hooks' }`, line 24).

**Tests that cover the allowlist and need extending:**
- `tests/metta-guard-bash.test.ts` — the allow/block matrix, already iterating **both** hook copies (`describe` loop at lines 70-74). Add: allow `metta config get uat.enforce_on_ship --json` (exit 0, no credential), block `metta config set x y` (exit 2, unknown/fail-closed), block bare `metta config` / `config edit`. Direct analogues exist at lines 173-183 (`gaps list/show` allowed, `gaps remove` blocked).
- `tests/cli-metta-guard-bash-integration.test.ts` — end-to-end tier checks; the roadmap-classification describe (lines 354-415) is the pattern for asserting the new entry plus the session-tier path.
- `tests/config-loader.test.ts` / schema tests — new `enforce_on_ship` default and strict-rejection cases (needed by the schema half of the change regardless of mechanism).

**Does any skill read config today?** No. `grep -rn "metta config" src/templates/skills/ .claude/skills/` returns nothing — no skill in either tree invokes `metta config`; this would be the first skill-layer config read. There is likewise no `config` presence anywhere in the guard's allow/block lists today, so all three `config` subcommands currently classify `'unknown'`.

## Pros

- **Single source of truth, schema-validated.** The skill reads exactly what `ConfigLoader` + Zod produce — defaults, env overrides, and local.yaml layering included — with no second serialization surface to keep in sync. Satisfies the delta-spec requirement that the value "reflects the strict-schema default when the key is omitted" (spec.md, "Config-read mechanism outcome" scenario) for free.
- **No `finalize` output-contract change.** `FinalizeResult` and its `--json` payload stay untouched — no schema addition, no consumer updates, no risk to pre-existing finalize fields (the alternative approach's main blast radius).
- **Decoupled from finalize execution.** Skills can consult the toggle *before* running finalize or at any later point (e.g. metta-ship gating a re-run on a branch propose already finalized) — the finalize-JSON route only surfaces the value at the one moment finalize runs, which is awkward for the propose-stop → later-ship idempotency flow.
- **Minimal, precedented guard delta.** One `ALLOWED_TWO_WORD` entry following the exact `gaps list`/`release status` precedent, including its comment convention and its existing test pattern. `config get` is genuinely read-only (no state write anywhere in its handler).
- **Reusable surface.** Any future skill-readable toggle rides the same allowlisted form with zero further guard changes.
- **Robust rollout for 5 of 6 skills.** Fork-tier skills work even under a stale deployed hook (fork identity already authorizes the call), so only `metta-fix-gap` depends on the hook pair actually being updated.

## Cons

- **Touches enforcement-sensitive files.** Both guard hook copies change; any allowlist edit invites scrutiny and requires careful negative tests (`config set`/`edit`/bare `config` must stay fail-closed). The alternative (finalize `--json` surfacing) leaves the guard untouched.
- **One extra Bash round-trip per ship run** (a `metta` CLI invocation + full config load) in every one of the six skills, vs. zero if the value piggybacked on finalize output the skills already parse.
- **Version-skew ambiguity on missing key.** A stale installed CLI (schema without `enforce_on_ship`) returns `{"key":...}` with the `value` field absent, not an error; skill wording must pin the fail-toward-enforce interpretation. The finalize-JSON route has the identical skew problem (absent field in older payloads), so this is a wash, but it must be written down.
- **Opens `config get *` broadly, not just this key.** The allowlist is keyed on `config get`, not the specific dot-path — orchestrators can then read any config value (including, say, tokens/env-adjacent settings) without a credential. All current config content is non-secret project settings, so this is acceptable, but it widens the read surface beyond the single toggle.
- **Skill prose must specify parse handling** (jq/inspection of `{"key","value"}`), one more inline contract in six skill pairs — though the skills already parse `metta finalize --json`, so the idiom is established.

## Complexity

Files touched for the toggle-read mechanism itself (beyond the schema/skill edits common to both approaches):

| File | Change |
|---|---|
| `src/templates/hooks/metta-guard-bash.mjs` | +1 `ALLOWED_TWO_WORD` entry + comment |
| `.claude/hooks/metta-guard-bash.mjs` | identical edit (byte-identity enforced) |
| `tests/metta-guard-bash.test.ts` | ~4 new cases (allow get; block set/edit/bare) x both copies via existing loop |
| `tests/cli-metta-guard-bash-integration.test.ts` | optional end-to-end allow + session-tier case |
| `src/schemas/project-config.ts` | `enforce_on_ship` field (common to both approaches) |
| six skill pairs (12 files) | the `config get` call + absent-value rule (call-site wording differs between approaches but the edit count is the same) |

Net mechanism-specific delta: 2 hook files + 1-2 test files. Low complexity; every piece has an existing in-repo precedent to copy.

## Failure modes

- **`.metta/config.yaml` missing entirely:** `loadYamlFile` returns `null` on ENOENT → `?? {}` → schema defaults → `value: true`. Exit 0. Correct fail-toward-enforce behavior, no special casing needed. (Contrast: `config set` errors on a missing file, `config.ts:86-88` — but skills never call `set`.)
- **Key absent but schema current:** Zod default fills it during `load()`; the dot-walk finds `true`. Exit 0.
- **Key absent AND CLI stale (pre-schema build):** `value` field omitted from the JSON line entirely (verified: `JSON.stringify({key, value: undefined})` → `{"key":"..."}`). Skills must treat absent-`value` as `true`. This is the one genuinely silent skew case — the pinned skill sentence should encode it.
- **Malformed/invalid config.yaml:** exit 4 with `config_error` JSON. Skill behavior should be fail-toward-enforce (or halt and report), never "toggle off"; needs one line of skill wording.
- **Guard hook copies drift or only one is edited:** `tests/template-deploy-sync.test.ts` fails the build (hooks pair pinned at line 24), and `tests/metta-guard-bash.test.ts` runs the matrix against both copies independently — double coverage.
- **Stale deployed hook at runtime** (session started before merge, or a host project that hasn't re-run install): fork-tier skills are unaffected (fork identity authorizes the call regardless of classification); session-tier `metta-fix-gap` gets a hard exit-2 block with the standard "update the allowlist" stderr — loud, not silent, and the operator-visible message names the fix. No path exists where the gate is silently skipped.
- **`config set` leakage:** none introduced. Untrusted contexts: `'unknown'` → fail-closed. Fork-tier: already reachable today independent of this change (fork identity short-circuit, guard lines 869-872) — this approach neither widens nor narrows that.

## Verdict

**Fit: 4/5.** Recommended, with two riders: (1) pin the skill sentence to treat an absent `value` field or load error as `enforce = true` (fail-toward-enforce under version skew), and (2) land negative guard tests keeping `config set`/`edit`/bare `config` fail-closed. It is a one-entry, fully precedented allowlist change whose only true dependent is session-tier `metta-fix-gap`, it returns the schema-defaulted effective value with zero new serialization surface, and it decouples the toggle read from finalize timing — which the propose-stop → later-ship idempotency flow needs and the finalize-`--json` alternative handles poorly. The lost point reflects that it edits enforcement-sensitive hook files and adds a per-run CLI round-trip where the alternative adds none.
