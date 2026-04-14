# metta install should not touch CLAUDE.md. That should be left to the metta init / /metta:init cmd. Currently install calls runRefresh() which regenerates CLAUDE.md, blurring the install/init boundary we just shipped.

**Captured**: 2026-04-14
**Status**: logged
**Severity**: minor

metta install should not touch CLAUDE.md. That should be left to the metta init / /metta:init cmd. Currently install calls runRefresh() which regenerates CLAUDE.md, blurring the install/init boundary we just shipped.
