# Flaky CI test teardown: ENOTEMPTY rmdir race in temp .git/objects during cli-complete tests — background git auto-gc/maintenance in temp repos races afterEach recursive rm on GitHub runners (seen on run 31262392642: 2/1859 failed, green on rerun). Candidate fixes: add 'git config --global gc.auto 0' (and gc.autoDetach false) to the CI git config step, or make test cleanup retry ENOTEMPTY/EBUSY via fs.rm maxRetries

**Captured**: 2026-08-08
**Status**: logged
**Severity**: minor

Flaky CI test teardown: ENOTEMPTY rmdir race in temp .git/objects during cli-complete tests — background git auto-gc/maintenance in temp repos races afterEach recursive rm on GitHub runners (seen on run 31262392642: 2/1859 failed, green on rerun). Candidate fixes: add 'git config --global gc.auto 0' (and gc.autoDetach false) to the CI git config step, or make test cleanup retry ENOTEMPTY/EBUSY via fs.rm maxRetries
