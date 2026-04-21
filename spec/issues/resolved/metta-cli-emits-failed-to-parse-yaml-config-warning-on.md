# metta CLI emits 'failed to parse YAML config' warning on malformed .metta/config.yaml (e.g., duplicate keys) but continues executing with defaults — masking real config corruption. Observed on zeus project: '.metta/config.yaml: Map keys must be unique at line 5, column 3'. Fix options: (a) exit with clear error when config parse fails so the user knows their config is corrupt; (b) fall back silently but print the corrupt file path + line and suggest 'metta doctor' to auto-fix; (c) 'metta doctor' subcommand that detects and repairs duplicate keys by keeping the last occurrence.

**Captured**: 2026-04-19
**Status**: logged
**Severity**: minor

metta CLI emits 'failed to parse YAML config' warning on malformed .metta/config.yaml (e.g., duplicate keys) but continues executing with defaults — masking real config corruption. Observed on zeus project: '.metta/config.yaml: Map keys must be unique at line 5, column 3'. Fix options: (a) exit with clear error when config parse fails so the user knows their config is corrupt; (b) fall back silently but print the corrupt file path + line and suggest 'metta doctor' to auto-fix; (c) 'metta doctor' subcommand that detects and repairs duplicate keys by keeping the last occurrence.
