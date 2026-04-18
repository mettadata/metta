# /metta-fix-issues skill assumes a 'metta issue show <slug>' subcommand which does not exist. Reproduced: running /metta-fix-issues <slug> as the first step attempted 'metta issue show <slug> --json' and errored with 'error: too many arguments for issue. Expected 1 argument but got 2.'. The 'metta issue' CLI currently only accepts a single description string. The skill's issue-fetching step needs to read the markdown file directly (e.g. Read spec/issues/<slug>.md) or be changed to 'metta issues show <slug>'/'metta issues get <slug>' depending on intended syntax. The skill recovered by reading the file, but the error is noisy.

**Captured**: 2026-04-18
**Status**: logged
**Severity**: minor

/metta-fix-issues skill assumes a 'metta issue show <slug>' subcommand which does not exist. Reproduced: running /metta-fix-issues <slug> as the first step attempted 'metta issue show <slug> --json' and errored with 'error: too many arguments for issue. Expected 1 argument but got 2.'. The 'metta issue' CLI currently only accepts a single description string. The skill's issue-fetching step needs to read the markdown file directly (e.g. Read spec/issues/<slug>.md) or be changed to 'metta issues show <slug>'/'metta issues get <slug>' depending on intended syntax. The skill recovered by reading the file, but the error is noisy.
