# V126 validation

- Platform: **2,092 passed**, zero failures, including **72 new V126 regressions**: 21 shared-drain boundary, 33 HTTP command/admission and 18 service/probe ownership tests.
- Production scaffold: **140 passed**, zero failures, **one skipped** optional real PostgreSQL integration suite.
- Security policy: **38/38 passed**. Repository security scan and knowledge lint report no findings.
- All **54 pinned migrations** remain unchanged; no new migration or provider dependency is introduced.
- Five enabled PostgreSQL CI cases add actual HTTP/domain commit/replay, cross-tenant input rejection, immutable binding conflicts, current actor withdrawal and full six-pool service canary/readiness/drain composition. Actual PostgreSQL execution is **not locally validated**. GitHub CI exposed and this batch fixes an ambiguous session-provider SQL parameter type; managed readiness integration waits for a complete supervised worker cycle, with cleanup on assertion failure. CodeQL receives the read-only workflow metadata permission required by its private-repository upload path.

All CI, including `postgres-security-integration`, must pass before merge. Tests use explicit synthetic drain/identity/provider/audit fixtures; they do not certify a real distributed control store or deployed cloud services. Shared durable backend provisioning, multi-process crash recovery, actual permissions/evidence/output effects, legacy application adoption and customer-data release remain outstanding.
