# V115 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux with Node v24.19.0 against a V114 baseline reconstructed from the supplied V57 archive and subsequent version patches. The user's canonical GitHub main was not directly fetched; application must pass git apply --check and the repository's CI before merge.

- Platform foundation: **1,739/1,739 passed**, including 8 new CLI tests.
- Production-shape scaffold: **118/118 passed**.
- Focused V66/V75/V115 evidence-tooling tests: **39/39 passed**.
- Security policy: **38/38 passed**.
- Security regression scan: clean.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration.

Tests cover canonical template generation, refusal to overwrite output, bounded validation errors without raw content, source preservation, partial-report refusal, explicit working-day input, empty evidence rejection, oversize/invalid-UTF-8 rejection, reproducible reports and bounded usage/file errors.

These are local engineering checks, not law-firm observation results, live integration validation, independent security review or production readiness. Windows and Node 22 execution remain subject to local/GitHub checks.
