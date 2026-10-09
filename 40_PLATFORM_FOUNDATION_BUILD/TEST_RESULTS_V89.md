# V89 Test Results — Microsoft Graph webhook ingress authenticity and replay containment

Date: 2026-10-09
Version: 0.10.44

## Result

- Platform test suite: **1,521 / 1,521 passed**
- Production-shape suite: **79 / 79 passed**
- Focused V89 Graph webhook-ingress suite: **12 / 12 passed**
- Security policy: **25 / 25 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V89 properties exercised

- endpoint validation reflects the opaque validation token only as plain text;
- receipt/acknowledgement is separate from authenticity validation and trusted dispatch;
- internal tenant identity is resolved from server-owned subscription state, never webhook JSON;
- basic notifications require exact secret clientState equality;
- unknown, inactive and expired subscriptions fail closed;
- webhook body and batch sizes are bounded before staging;
- change and lifecycle notification semantics are mutually exclusive and validated;
- notification fingerprints identify replay/duplicates before dispatch;
- rich notifications require trusted validation-token claims bound to directory tenant, app ID and the Microsoft Graph notification publisher;
- no rich notification token is trusted without an injected verifier;
- validated output excludes clientState, validation tokens, payload tenant and resourceData;
- production evidence is tenant-bound, forced-RLS, append-only and contains hashes/fingerprints rather than raw notification payloads.

The in-memory staging/dedupe structures and injected claims verifier are reference/test boundaries only. V89 does not claim a live Microsoft Graph webhook endpoint, managed ingress queue or live JWT/JWKS validation service.
