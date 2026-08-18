#!/usr/bin/env node
// PreToolUse Bash hook: the Tier-2 credential-MINTING half of the two-tier trust model.
// This script is the sole minter of the non-forgeable per-skill session token at
// <cwd>/.metta/scratch/skill-session/<slug>.token that the validating half,
// metta-guard-bash.mjs, checks before allowing main-session lifecycle subcommands
// (complete, finalize, refresh, import, init, fix-gap, verify, scoped backlog forms).
// Each token is stamped with the runtime-supplied event.session_id, binding it to the
// live Claude Code session. The guard judges freshness in two bands: a FRESH band
// (age < ttlMs, the classic sliding TTL) and a session-bound RE-PRIMABLE band
// (same sessionId, age < ttlMs + GRACE_MS) — during delegation windows where this
// hook cannot fire (subagent turns), the guard itself re-primes the token on
// authorized use. This hook remains the only *minting* half; the guard is the
// re-priming half. Each skill's mint hook owns exactly one token file — its own —
// so hooks accumulated from previously invoked skills in the same session can never
// clobber or suppress the genuinely active skill's credential. The skill slug
// argument on this script's command line is a static, ship-time-authored string
// baked into each Tier-2 skill's frontmatter — never sourced from event data.
// This hook never blocks a tool call: it only mints, swallows all errors, and exits 0.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Per-skill subcommand scoping: a token minted for one skill authorizes only the
// subcommands that skill's body legitimately drives. Two-word forms are keyed
// "<sub>:<third>". Keys are the 11 Tier-2 (non-forked) skill slugs.
const SKILL_SCOPES = {
  'metta-next': ['complete', 'finalize'],
  'metta-plan': ['complete'],
  'metta-execute': ['complete'],
  'metta-verify': ['verify', 'complete'],
  'metta-refresh': ['refresh'],
  'metta-import': ['import'],
  'metta-init': ['init', 'refresh'],
  'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote', 'backlog:migrate', 'milestone:create'],
  'metta-fix-gap': ['fix-gap', 'complete', 'finalize'],
  'metta-roadmap': ['roadmap:add', 'roadmap:reorder', 'roadmap:next', 'roadmap:remove'],
  'metta-release': ['release:cut'],
};

const TTL_MS = 300000; // 5 min sliding TTL, re-primed at 80% (see design.md Data Model).
// MUST equal GRACE_MS in metta-guard-bash.mjs — the guard's re-prime horizon and this
// hook's sibling-cleanup threshold are one policy; seam tests pin the equality.
const GRACE_MS = 3_600_000;

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Opportunistic hygiene at mint time: delete genuinely dead or malformed sibling
// token files (other skills' tokens past ttlMs + GRACE_MS — the guard's re-prime
// horizon; cleanup must never delete a token the guard would still re-prime) and
// stale *.tmp orphans from a crashed writer. Never touches fresh or re-primable
// sibling tokens — concurrent skills keep their own valid credentials. All errors
// are swallowed.
function cleanupSiblings(tokenDir, ownFile, now) {
  let names = [];
  try { names = readdirSync(tokenDir); } catch { return; }
  for (const name of names) {
    if (name === ownFile) continue;
    if (!name.endsWith('.token')) {
      // Best-effort removal of *.tmp orphans left by a crashed atomic writer.
      if (name.endsWith('.tmp')) {
        const tmpPath = join(tokenDir, name);
        try {
          if (now - statSync(tmpPath).mtimeMs >= TTL_MS) unlinkSync(tmpPath);
        } catch { /* swallow */ }
      }
      continue;
    }
    const siblingPath = join(tokenDir, name);
    let expired = true;
    try {
      const tok = JSON.parse(readFileSync(siblingPath, 'utf8'));
      expired =
        typeof tok !== 'object' || tok === null ||
        !Number.isFinite(tok.mintedAt) ||
        !Number.isFinite(tok.ttlMs) ||
        now - tok.mintedAt >= tok.ttlMs + GRACE_MS;
    } catch {
      expired = true; // unreadable/unparsable siblings are dead weight — remove
    }
    if (expired) {
      try { unlinkSync(siblingPath); } catch { /* swallow */ }
    }
  }
}

function main() {
  const raw = readStdin();
  if (!raw) process.exit(0);
  let event;
  try { event = JSON.parse(raw); } catch { process.exit(0); }
  if (event.tool_name !== 'Bash') process.exit(0);

  // Defensive: only the 11 Tier-2 skills invoke this script with their own slug.
  const slug = process.argv[2];
  if (!Object.prototype.hasOwnProperty.call(SKILL_SCOPES, slug)) process.exit(0);

  const cwd = event.cwd ?? process.cwd();
  const tokenDir = join(cwd, '.metta', 'scratch', 'skill-session');
  const ownFile = `${slug}.token`;
  const tokenPath = join(tokenDir, ownFile);

  // Read this skill's OWN existing token if present; I/O or parse errors are
  // treated as absent. Other skills' tokens are never consulted here — freshness
  // of a different skill's credential must not suppress this skill's mint.
  let existing = null;
  try { existing = JSON.parse(readFileSync(tokenPath, 'utf8')); } catch { existing = null; }

  // Sliding TTL: keep a fresh token untouched (no write/rotation on every call);
  // re-mint when absent, unparsable, malformed, or past 80% of its TTL.
  const stale =
    existing === null ||
    !Number.isFinite(existing.mintedAt) ||
    !Number.isFinite(existing.ttlMs) ||
    Date.now() - existing.mintedAt >= existing.ttlMs * 0.8;
  if (!stale) process.exit(0);

  const now = Date.now();
  const token = {
    token: randomUUID(),
    skill: slug,
    subcommands: SKILL_SCOPES[slug],
    mintedAt: now,
    ttlMs: TTL_MS,
    // Runtime-supplied session binding: the guard's strict === against a string
    // makes any non-string value inert (never re-primable, fail-closed) — so no
    // type check here.
    sessionId: event.session_id ?? null,
  };

  // Mint failures must never break the calling skill's Bash call — swallow all I/O errors.
  // Atomic write (temp + same-directory rename): the validating guard may read or
  // re-prime this file concurrently; rename removes the torn-read window.
  try {
    mkdirSync(tokenDir, { recursive: true });
    const tmpPath = `${tokenPath}.${randomUUID()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(token), { mode: 0o600 });
    renameSync(tmpPath, tokenPath);
  } catch {
    // swallow
  }

  cleanupSiblings(tokenDir, ownFile, now);

  // The retired single-file credential (<cwd>/.metta/scratch/skill-session.token)
  // is no longer written or honored — remove any lingering copy so nothing can
  // mistake it for a live credential.
  try { unlinkSync(join(cwd, '.metta', 'scratch', 'skill-session.token')); } catch { /* swallow */ }

  process.exit(0);
}

main();
