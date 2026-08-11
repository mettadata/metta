#!/usr/bin/env node
// PreToolUse Bash hook: the Tier-2 credential-minting half of the two-tier trust model.
// This script mints (and slide-rotates) the non-forgeable per-skill session token at
// <cwd>/.metta/scratch/skill-session/<slug>.token that the validating half,
// metta-guard-bash.mjs, checks before allowing main-session lifecycle subcommands
// (complete, finalize, refresh, import, init, fix-gap, verify, scoped backlog forms).
// Each skill's mint hook owns exactly one token file — its own — so hooks accumulated
// from previously invoked skills in the same Claude Code session can never clobber or
// suppress the genuinely active skill's credential. The skill slug argument on this
// script's command line is a static, ship-time-authored string baked into each Tier-2
// skill's frontmatter — it is never sourced from event data and is not
// orchestrator-controlled.
// This hook never blocks a tool call: it only mints, swallows all errors, and exits 0.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
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
  'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote'],
  'metta-fix-gap': ['fix-gap', 'complete', 'finalize'],
  'metta-roadmap': ['roadmap:add', 'roadmap:reorder', 'roadmap:next'],
  'metta-release': ['release:cut'],
};

const TTL_MS = 300000; // 5 min sliding TTL, re-primed at 80% (see design.md Data Model).

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Opportunistic hygiene at mint time: delete expired or malformed sibling token
// files (other skills' tokens whose TTL has lapsed) and the retired single-file
// credential path. Never touches fresh sibling tokens — concurrent skills keep
// their own valid credentials. All errors are swallowed.
function cleanupSiblings(tokenDir, ownFile, now) {
  let names = [];
  try { names = readdirSync(tokenDir); } catch { return; }
  for (const name of names) {
    if (name === ownFile || !name.endsWith('.token')) continue;
    const siblingPath = join(tokenDir, name);
    let expired = true;
    try {
      const tok = JSON.parse(readFileSync(siblingPath, 'utf8'));
      expired =
        typeof tok !== 'object' || tok === null ||
        !Number.isFinite(tok.mintedAt) ||
        !Number.isFinite(tok.ttlMs) ||
        now - tok.mintedAt >= tok.ttlMs;
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
  };

  // Mint failures must never break the calling skill's Bash call — swallow all I/O errors.
  try {
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(tokenPath, JSON.stringify(token), { mode: 0o600 });
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
