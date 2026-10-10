# V137 test results

- Platform: 2,705/2,705 pass, including 60 new capacity regressions.
- Scaffold: 140 pass, 0 fail, 1 skipped real-PostgreSQL parent suite.
- Legacy: starter 7/7, reference 17/17, dev-control 5/5 pass.
- Security policy: 38/38 pass. Repository scan: no findings/missing concepts.
- Synthetic CLI: 28 per replica, 84 fleet, 16 headroom; exits 0.
- Two connected PostgreSQL cases added; native PostgreSQL cannot run locally.
  Full PostgreSQL 17 CI required before merge; no local database success claimed.
- No migration/dependency changed. Local Node 24.19.0; CI validates Node 22.

The operator supplies the quota and replica budget. The guard does not discover
provider limits, enforce fleet size globally or independently attest adapters.
No cloud deployment, protection change, customer-data processing or writeback occurs.
D-018/customer-data gates remain; V131 stays paused.
