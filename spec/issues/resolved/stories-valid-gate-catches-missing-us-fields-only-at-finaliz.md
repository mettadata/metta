# stories-valid gate catches missing US fields only at finalize. Missing iWantTo or acceptanceCriteria on a US entry is only caught by the stories-valid gate at metta finalize — by which point the stories artifact has already been 'completed' and downstream artifacts (spec/design/tasks) have been written against incomplete data. Fix: run stories-valid as a pre-complete gate on the stories artifact so gaps surface before spec/design/tasks work begins.

**Captured**: 2026-04-15
**Status**: logged
**Severity**: major

stories-valid gate catches missing US fields only at finalize. Missing iWantTo or acceptanceCriteria on a US entry is only caught by the stories-valid gate at metta finalize — by which point the stories artifact has already been 'completed' and downstream artifacts (spec/design/tasks) have been written against incomplete data. Fix: run stories-valid as a pre-complete gate on the stories artifact so gaps surface before spec/design/tasks work begins.
