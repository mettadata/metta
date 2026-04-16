# no --accept-recommended mode for discovery rounds. When driving metta via automation or CI (e.g., tmux-based e2e dogfood), every AskUserQuestion in the discovery loop requires individual selection. A --auto flag on /metta-propose and /metta-init that picks the first (Recommended) option per question would dramatically speed up automated flows. Already exists in some GSD skills (--auto flag); metta should adopt the pattern.

**Captured**: 2026-04-16
**Status**: logged
**Severity**: minor

no --accept-recommended mode for discovery rounds. When driving metta via automation or CI (e.g., tmux-based e2e dogfood), every AskUserQuestion in the discovery loop requires individual selection. A --auto flag on /metta-propose and /metta-init that picks the first (Recommended) option per question would dramatically speed up automated flows. Already exists in some GSD skills (--auto flag); metta should adopt the pattern.
