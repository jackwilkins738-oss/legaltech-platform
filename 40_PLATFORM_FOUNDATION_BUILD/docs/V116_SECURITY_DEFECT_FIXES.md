# V116 — Seven security defect fixes

STATUS: CURRENT
DOMAIN: platform_build / security_privacy

This release fixes the seven code defect groups reproduced during the V115 security review. It does not claim production readiness or replace independent security assessment.

| Defect | Resulting behaviour |
| --- | --- |
| Restricted candidate disclosure | Every candidate in an inbound event or exception requires current matter access. An event/exception containing an inaccessible candidate is withheld entirely, including on detail/review routes. Mixed authorised/restricted candidates are withheld rather than partially redacted. |
| Support scope confusion | MATTER_READ, DOCUMENT_READ and DIAGNOSTIC_READ are distinct authorities. Diagnostics cannot satisfy matter/document reads. |
| Support audit/state inconsistency | Required synchronous audit succeeds before request or approval state becomes effective. Failed approval stays pending; failed request creates no effective request. Revocation removes access even if its audit fails, and the failure propagates rather than publishing false success. |
| IPv6 loopback bypass | Address parsing canonicalises expanded/mapped IPv6 before classification. Non-global IPv6, documentation and selected transition ranges are rejected for ordinary public egress. Explicit exact private-service pins retain their separate authority. |
| Document redemption races | After asynchronous document resolution, current interlocks, grant status and expiry are rechecked immediately before the synchronous one-use claim. Concurrent redemption permits at most one storage read in the reference instance. |
| Stale export permission | A private immutable resource inventory remains bound to the manifest hash. Every resource is re-authorised at grant creation and consumption; failure denies delivery. Inventory is not added to public export views or audit events. |
| Signing-key refresh abuse | JWKS fetch/body reads share a bounded deadline and abort signal. Refreshes coalesce; a global refresh cooldown bounds arbitrarily many unknown key IDs without an unbounded negative cache. Known valid cached keys remain usable until their cache expires. |

JWKS options: `timeoutMs` defaults to 5,000 (100–10,000 supported); `refreshCooldownMs` defaults to 30,000 (1,000–60,000 supported). Legitimate new keys can be discovered after cooldown. During an unavailable/expired lookup, authentication fails closed. Rotation planning must account for the configured cooldown.

Support audit adapters must complete synchronously in this reference registry. Promise-returning adapters are rejected; production asynchronous auditing needs a transactional implementation rather than pretending a fire-and-forget callback committed evidence. If a revocation audit fails, access stays revoked and the caller must handle/escalate the audit error. That state is a deliberate fail-closed exception, not atomic durable auditing.

## Regression evidence

`test/securityFixesV116.test.js` exercises 19 regressions covering cross-scope support use, audit request/approval/revocation failure, asynchronous audit rejection, expanded/mapped address equivalence, explicit pins, simultaneous redemption, expiry and containment during resolution, export permission withdrawal/outage, concurrent unknown keys, rotation, stalled headers/body cancellation, hidden/mixed matter candidates, authorised review and current security-zone withdrawal.

## Remaining deployment work

These services remain reference implementations with local state. Multi-instance one-use enforcement, shared revocation/containment, persistent export inventories and transactional audit require production stores and adapters. The HTTP readiness endpoint still needs a deliberate production admission/gateway policy. PostgreSQL RLS must be executed and tested under real runtime roles, not inferred from SQL-text checks. Managed scanning, cloud permissions, backups/restore and live integrations still need deployed evidence.

V116 is a bounded defect-fix exception under D-018. The TO can proceed; customer-data deployment remains gated. Reverting this PR reintroduces the confirmed defects and should only be considered in the synthetic environment while a corrected replacement is prepared.
