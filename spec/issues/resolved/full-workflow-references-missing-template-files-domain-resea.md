# full workflow references missing template files (domain-research.md, architecture.md, ux-spec.md). src/templates/workflows/full.yaml lists these as artifact templates but they are absent from src/templates/artifacts/. TemplateEngine.load() throws on first encounter. Running metta propose --workflow full creates the change successfully but any subsequent metta instructions <artifact> call for a missing template crashes. Fix: either create the three template files, remove the three stages from full.yaml, or remove the full workflow entirely.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: major

full workflow references missing template files (domain-research.md, architecture.md, ux-spec.md). src/templates/workflows/full.yaml lists these as artifact templates but they are absent from src/templates/artifacts/. TemplateEngine.load() throws on first encounter. Running metta propose --workflow full creates the change successfully but any subsequent metta instructions <artifact> call for a missing template crashes. Fix: either create the three template files, remove the three stages from full.yaml, or remove the full workflow entirely.
