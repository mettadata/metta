# no helper/codemod for bumping test fixtures after schema migration. Each schema version bump in a project (card/board/workspace field additions) forces manual sed across every test file with typed Card/Board/Workspace literals. Error-prone; several trello-clone features broke many tests because sed missed a literal shape variant. Suggestion: ship a declarative test-board-factory template or a codemod tool as part of metta for projects that use versioned workspace schemas.

**Captured**: 2026-04-15
**Status**: closed (won't-fix)
**Severity**: minor
**Resolution**: 2026-04-17 — closed as out of scope. Metta is a language-agnostic spec-driven development framework; shipping a TypeScript-specific test-factory scaffolder or AST codemod is a step sideways into general-purpose code generation that belongs in separate tooling (hygen, plop, ts-morph). Projects adopting metta handle their own language-specific fixture patterns.

no helper/codemod for bumping test fixtures after schema migration. Each schema version bump in a project (card/board/workspace field additions) forces manual sed across every test file with typed Card/Board/Workspace literals. Error-prone; several trello-clone features broke many tests because sed missed a literal shape variant. Suggestion: ship a declarative test-board-factory template or a codemod tool as part of metta for projects that use versioned workspace schemas.
