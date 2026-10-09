# V125 validation

- Platform: **2,020 passed**, zero failures, including **57 new V125 regressions**: 17 managed-artifact, 15 result-adoption and 25 canary/composition/readiness cases.
- Production scaffold: **140 passed**, zero failures, **one skipped** optional PostgreSQL integration suite.
- Security policy: **38/38 passed**. Repository scan and knowledge lint report no findings.
- Migration directory: **54 checksum-pinned migrations** verify; migration 054 is non-destructive and earlier checksums remain unchanged.
- Eight new enabled PostgreSQL CI cases cover the actual domain-result FK/atomic state path, replay/conflict, forged/partial receipt rollback, role/RLS isolation, current-authority withdrawal, disabled protection, connected managed canary and production-readiness rejection. Enabled PostgreSQL execution is **not locally validated**.

All CI, including `postgres-security-integration`, must pass before merge. Synthetic CI SDK/evidence callbacks do not validate real cloud services, release/scanner approvals or actual provider permissions. HTTP/SQLite production adoption, business processors/output effects, managed shared drain, canary scheduling and customer-data deployment remain outside the validated batch.
