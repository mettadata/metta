# Implementation Summary: model-tier-routing-orchestration-agents-top-tier-models

## What changed

Metta now routes model tiers deliberately: top-tier models author and review, cheaper models execute well-specified small work, and a two-rung escalation ladder self-heals when the cheap bet loses.

- **The accidental inversion is fixed**: the five `model: sonnet` pins deleted from the planning-agent files (10 copies) — planning agents now inherit the session's top-tier model. Reviewer and verifier were already inheriting; they are now *structurally* immune (schema accepts only the literal `inherit` for them).
- **Config surface** (`ModelsConfigSchema` on `.metta/config.yaml`): named profiles (`quality` all-inherit, `balanced` sonnet executors, `budget` haiku-trivial/sonnet-quick) plus an explicit per-tier executor map (explicit wins, profile fills gaps, warning when both). Closed vocabulary (`sonnet|opus|haiku|fable|inherit`) validated at load. No planning-cohort key is representable. No config → everything `inherit`, byte-for-byte prior behavior.
- **Dynamic emission** (`resolveAgentModel` + instruction pipeline): the instruction contract's agent block now carries `model`, computed per generation from profile × the change's *current* workflow tier — quick/trivial changes may get the cheap executor; standard/full always inherit. Skills pass it to the Agent tool's model parameter.
- **Rung-1 escalation**: `metta model-escalation record` (mirroring `iteration record`, allow-listed in both guard copies) appends to a new `model_escalations` array — distinct from the tier-routing `escalation` field, avoiding concept conflation. Any record for an artifact is a one-way ratchet: subsequent emissions force `inherit`. Skill contracts (metta-execute/metta-verify) instruct recording on STOP/verify-FAIL of a downgraded run. Rung-2 (scope overflow) routes to the existing upscale machinery, untouched.
- **Honest metrics**: instructions.ts itself stamps a `model_runs` record on every non-inherit executor emission (mechanically reliable denominator); `metta progress` reports the escalation rate with zero-vs-no-data distinction, explicitly not claiming to detect silent wrong-output.

## Requirement coverage

All 8 instruction-contracts delta requirements (1 MODIFIED — the agent-identity contract gains `model`; 7 ADDED). US-5 (Rung-2 reuse) verified without new upscale code, per design.

## Verification

Suite 1447/1447 (87 files, ~290 net new tests incl. a 259-case resolver matrix); tsc/build clean. Live fixture proof: budget profile + quick tier emitted `sonnet` for the executor and `inherit` for the proposer; an escalation record flipped subsequent emissions to `inherit` (ratchet proven twice — including against a ready artifact); `model_runs` stamping and rate rendering covered by CLI-driven tests.

## Commits

`a33aa3147` (schemas), `d6ad25008` (resolver), `510cbc7a3` (emission + ratchet + denominator), `d18f4b027` (escalation CLI), `a58bd4028` (metric), `cb5412104` (sonnet-pin removal), `d4c157d24` (skill contracts).

## Notes / follow-ups

- Cosmetic: the instructions banner now renders `[METTA-METTA-EXECUTOR]` (double prefix since 5a's metta_agent change) — paper-cut candidate.
- The escalation-rate metric only becomes meaningful once a profile is configured and cheap-tier changes flow; recommend enabling `balanced` on this repo after ship and watching the rate.
