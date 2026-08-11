#!/usr/bin/env node
// Emits dist/.build-stamp recording the git HEAD at build time so that
// `metta doctor` can detect a dist/ that has drifted behind the checkout
// (spec issue: hooks-and-statusline-execute-stale-main-checkout-dist-via).
//
// Usage: node scripts/emit-build-stamp.mjs [package-root]
// (package-root defaults to the directory above this script)
//
// This step must never fail the build: when git is unavailable or the
// package root is not a git checkout, the commit is recorded as null so
// doctor can report "cannot verify" instead of the build breaking.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))

let commit = null
try {
  const out = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (/^[0-9a-f]{40}$/.test(out)) commit = out
} catch {
  commit = null
}

const stamp = { commit, built_at: new Date().toISOString() }
mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist', '.build-stamp'), `${JSON.stringify(stamp)}\n`, 'utf8')
