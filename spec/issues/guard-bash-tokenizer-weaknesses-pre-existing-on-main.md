---
priority: high
---
# guard-bash tokenizer weaknesses (pre-existing on main, confirmed during PR #86 security review): (1) chain separators are matched only as standalone whitespace-delimited tokens, so glued forms bypass invocation detection: 'metta backlog --json;metta backlog add x' and the &&-glued equivalent are allowed while bash executes the second write; (2) newline is a bash command separator but not in the hook separator list; (3) wrapper prefixes (command metta / env metta / backslash-metta) hide the invocation entirely, inherent to textual guarding, worth an acknowledging comment; (4) quote-unaware tokenizer means a quoted standalone double-dash argument over-blocks fail-closed (this already bit when logging this very issue). Fix suggestion for 1-2: split on /([;|&]+)/ and newlines before whitespace tokenization. Affects src/templates/hooks/metta-guard-bash.mjs + .claude/hooks/metta-guard-bash.mjs (byte-identical pair).

**Captured**: 2026-08-17
**Status**: logged
**Severity**: major

guard-bash tokenizer weaknesses (pre-existing on main, confirmed during PR #86 security review): (1) chain separators are matched only as standalone whitespace-delimited tokens, so glued forms bypass invocation detection: 'metta backlog --json;metta backlog add x' and the &&-glued equivalent are allowed while bash executes the second write; (2) newline is a bash command separator but not in the hook separator list; (3) wrapper prefixes (command metta / env metta / backslash-metta) hide the invocation entirely, inherent to textual guarding, worth an acknowledging comment; (4) quote-unaware tokenizer means a quoted standalone double-dash argument over-blocks fail-closed (this already bit when logging this very issue). Fix suggestion for 1-2: split on /([;|&]+)/ and newlines before whitespace tokenization. Affects src/templates/hooks/metta-guard-bash.mjs + .claude/hooks/metta-guard-bash.mjs (byte-identical pair).
