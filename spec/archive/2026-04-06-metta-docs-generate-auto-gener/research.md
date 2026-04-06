# Research: metta docs generate

## Decision: Template-based generation

### Approaches Considered
1. **Template-based** (selected) — read specs/archives, fill markdown templates. No AI needed. Deterministic, fast, offline.
2. **AI-driven** — send to provider for prose generation. Better quality but costs tokens and requires API key.

### Rationale
Template-based is the clear choice per user's discovery answers. The data is already structured (specs have requirements/scenarios, archives have summaries/dates, constitution has sections). No prose generation needed — just extraction and formatting.
