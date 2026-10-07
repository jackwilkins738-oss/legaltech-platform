# V39 validation

Lifecycle: current engineering validation. Synthetic data only.

- Current platform: 89/89 passing (51 existing + 38 writeback/security/UI regressions).
- Reproduced baseline defect: two external write calls after an uncertain response.
- Failure adapter has no native idempotency; the worker must prevent another call.
- Tests cover lost response after commit, unconfirmed outcomes, receipt/read failure,
  malformed receipts, trusted known failures, delayed/ambiguous/wrong-scope history,
  restart/abandoned leases, legacy retry upgrade, tenant/command isolation, fresh-key
  approval abuse, rejection reversal, transactional audit failure, external-call
  preconditions, exhausted/running-job read-only recovery, overlapping jobs, late
  receipts, receipt-persistence failure, privileged API/idempotency boundaries,
  tenant/event queue selection, scoped lease recovery and honest UI notices.
- Tests exercise durable local SQLite. No schema migration or data reset required.

- Legacy CI suites: technical starter 7/7; reference 17/17; production-shape
  contracts 14/14; dev-control contracts 5/5.
- Security policy tests: 4/4. Security scan: no secret, unsafe-default or sensitive-log hits.
- Knowledge lint: 0 errors, 0 warnings; Git whitespace check passes.
- Local app smoke: V39 UI, selected-event approval, durable verified writeback,
  completed read-only recovery and event status all pass.
- Installer: applied successfully to V38 fixtures with differing catalog bytes;
  passed dirty-edit refusal, repeat runs and Windows line-ending rules. Embedded
  PowerShell payload matches the tested Node updater; no commit, push or reset.
  Tests ran on Linux; the updater repeats checks on the Windows checkout.
Real Proclaim/Graph, production identity, distributed lease semantics and customer
access remain unproven.
