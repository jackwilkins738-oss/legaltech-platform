# Private-repository scanning

`ci-rules.json` vendors the 35 JavaScript/TypeScript and Python rules from
Semgrep's `p/ci` pack retrieved on 2026-10-10. Rule IDs, version metadata,
attribution and the Semgrep Rules License v1.0 notices are retained in each rule.
Source: https://semgrep.dev/c/p/ci
License: https://semgrep.dev/legal/rules-license

Pinned Semgrep Community Edition 1.180.0 scans source on the GitHub runner,
using these local rules, without a Semgrep account, token, cloud upload or
metrics. Findings, parsing errors and rule/configuration errors fail CI.
Default Semgrep exclusions apply, including test fixtures and generated files;
the existing security regression, policy, secret scan and domain tests remain.
`verify_semgrep.py` proves the scanner blocks insecure JavaScript and Python
fixtures before each source scan. Rule changes must be reviewed and re-tested.

This is a high-confidence static baseline, not equivalent to CodeQL's deeper
data-flow coverage. It does not certify absence of vulnerabilities. Findings
appear in Actions logs; GitHub's paid code-scanning dashboard is unavailable.

Dependency Audit replaces the unavailable dependency-review API with current
`npm audit --audit-level=high` of all tracked Node manifests with external
dependencies. Committed matching locks are mandatory; installation uses an
isolated directory with scripts disabled, and registry errors fail the gate.
Development dependencies are included, including the pinned PostgreSQL CI
driver. Dependency-free manifests are reported explicitly. New Python or
alternative Node dependency manifests require added audit support and fail
instead of silently skipping. Scanner bootstrap dependencies and Actions
runtime packages are outside this application dependency audit.

Both jobs run on pull requests, main pushes and weekly schedules. No security
events write token or paid organization subscription is required. Old CodeQL
checks remain on previous commits; any branch rule that explicitly requires
their old workflow name must be updated to require the new scanner instead.
