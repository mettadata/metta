# Verification: PASS

- tsc clean
- gate-registry: 22/22 pass (incl. 3 new override tests)
- All 7 spec scenarios covered:
  - override-replaces-built-in: test 1
  - missing-dir-silent-pass-through: test 3
  - partial-override: test 2
  - deterministic-load-order: sorted readdir + test 2 (`lint` unchanged)
  - docs-override-mention: `docs/getting-started.md` has the `.metta/gates` section
