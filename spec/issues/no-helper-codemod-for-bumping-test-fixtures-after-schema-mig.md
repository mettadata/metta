# no helper/codemod for bumping test fixtures after schema migration. Each schema version bump in a project (card/board/workspace field additions) forces manual sed across every test file with typed Card/Board/Workspace literals. Error-prone; several trello-clone features broke many tests because sed missed a literal shape variant. Suggestion: ship a declarative test-board-factory template or a codemod tool as part of metta for projects that use versioned workspace schemas.

**Captured**: 2026-04-15
**Status**: logged
**Severity**: minor

no helper/codemod for bumping test fixtures after schema migration. Each schema version bump in a project (card/board/workspace field additions) forces manual sed across every test file with typed Card/Board/Workspace literals. Error-prone; several trello-clone features broke many tests because sed missed a literal shape variant. Suggestion: ship a declarative test-board-factory template or a codemod tool as part of metta for projects that use versioned workspace schemas.
