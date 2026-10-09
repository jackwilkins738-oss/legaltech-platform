# V116 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux / Node v24.19.0 against the reconstructed supplied V115 baseline. Canonical GitHub main and Windows execution were not directly tested; apply-check and GitHub CI remain required.

- Full platform suite: **1,758/1,758 passed**.
- New V116 counterexample tests: **19/19 passed**.
- Existing directly affected identity/support/document/export/egress suites: **63/63 passed** during focused validation.
- Security policy tests: **38/38 passed**.
- Security regression scan: no listed hits.
- Production-shape scaffold: **118/118 passed**.
- Technical starter / reference / dev-control suites: **7/7, 17/17 and 5/5 passed**.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration.

All seven defect groups have regression coverage. Remaining shared-state/production admission, PostgreSQL execution and live operational validation are not certified by these results. See `docs/V116_SECURITY_DEFECT_FIXES.md` for behaviours and limitations.
