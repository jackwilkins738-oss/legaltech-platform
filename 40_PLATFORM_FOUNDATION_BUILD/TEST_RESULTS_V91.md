# V91 Test Results — Durable Microsoft Graph webhook queue and validation worker

Date: 2026-10-09
Version: 0.10.46

## Result

- Platform test suite: **1,544 / 1,544 passed**
- Production-shape suite: **82 / 82 passed**
- Focused V91 webhook queue suite: **11 / 11 passed**
- Security policy: **27 / 27 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V91 properties exercised

- bounded callback staging acknowledges without trusted dispatch;
- queue state/events expose hashes and counters, never webhook body/clientState/resource data;
- validation precedes downstream dispatch;
- invalid authenticity dead-letters without retry;
- explicit managed-secret/verifier dependency outages retry;
- expired worker leases recover within bounded attempt counts;
- queue overload is refused before acknowledgement;
- terminal queue items discard raw payload content;
- dispatch failure can retry the same validated fingerprint;
- network replay may re-present a fingerprint while idempotent downstream handling executes once;
- V89 remains fail-closed for unknown resolver/verifier failures.

The queue and idempotent dispatcher are reference/test boundaries only. V91 does not claim a deployed managed queue, worker service, dead-letter service, or production downstream consumer.
