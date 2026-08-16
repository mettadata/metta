# metta-init should capture per-project verification strategy and persist to config for verifier agents

**Added**: 2026-04-19
**Status**: backlog
**Priority**: medium

The QA/verification steps need per-project guidance on HOW to test the running app. Today verifier agents only run tests/tsc/lint — they do not drive the actual application. /metta-init discovery should ask the project owner for a verification strategy and save it to .metta/config.yaml. Strategy examples: (a) zeus: start the TUI via tmux pane, exercise keystrokes/scenarios from stories.md; (b) web apps: open a browser via Playwright MCP, run through acceptance scenarios; (c) CLI tools: invoke subcommands and compare stdout/exit codes; (d) libraries: tests only (current default). Verifier agents would read this config and follow its instructions during the verification fan-out, in addition to the existing test/tsc/lint gates. Captured from a live zeus session where the user had to manually say 'when finished you can test via the TMUX panel running the TUI' — that instruction should have been pre-wired at init time.
