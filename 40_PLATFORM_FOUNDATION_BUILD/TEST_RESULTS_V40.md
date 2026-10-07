# V40 validation

Lifecycle: current synthetic engineering validation.

- Platform suite: 111/111 (89 existing + 20 inbound failure/concurrency/API tests
  + 2 scenario UI tests).
- Reproduced V39 acceptance audit failure leaving one accepted event; processing
  audit failure followed by retry produced two review exceptions and disclosed raw
  internal error content in the worker response.
- Acceptance rollback covers event insertion, job enqueue, idempotency persistence,
  audit and object storage failures. The same key then safely retries.
- Processing rollback covers exception creation, event update, processing audit and
  job completion. Restart and retry create one exception and one processing audit.
- Approval-ready state requires successful processing audit. Competing jobs and
  delayed classifier results preserve review, approval, rejection and completion.
- Duplicate and historical processed jobs skip AI and preserve event state.
- Malformed classifier responses cannot become approval-ready; retries are bounded.
- Worker and HTTP response checks exclude raw provider error content.
- UI requires successful processing evidence for the selected event and reports
  failure/missing/unrelated results without claiming review completion.

- Legacy CI suites pass: technical starter 7/7; reference 17/17; production-shape
  contracts 14/14; dev-control contracts 5/5.
- Security policy tests: 4/4. Regression scan: no secret, unsafe-default or sensitive
  logging findings. Knowledge lint: 0 errors, 0 warnings. Catalog check passes.
- Updater applies to a V39 baseline despite catalog differences, refuses dirty edits
  and the wrong base branch, passes repeat runs and Windows line-ending fixtures.
  Embedded PowerShell payload matches the tested Node updater. No commits, pushes,
  merges or resets performed. Git whitespace check passes.
Tests run on Linux; the updater repeats them on the Windows checkout. This is not
production validation or evidence of real Graph/Proclaim/customer behavior.
