# V79 — Data lifecycle, legal holds and disposition approval

V79 adds a generic retention/disposition control plane without inventing a firm retention schedule and without giving the application an automatic deletion capability.

## Versioned retention policy

Retention periods exist only inside an explicitly published tenant policy. Draft policy is not authoritative; periods are bounded from 1 to 36,500 days and are pinned by policy version plus SHA-256 definition hash when a disposition is planned. Publishing a newer version retires the prior version, and a pending intent pinned to an older version cannot later be approved. This is the **versioned retention policy** boundary.

## Legal holds

A legal hold may target a whole internal matter or one resource identity. Active holds block disposition planning and are checked again at approval, so a hold placed after planning still stops progress. Hold reason/release evidence uses bounded codes rather than free-text client facts, releases are explicit, and lifecycle events are append-only. This is the **legal hold fail closed** boundary.

## Dual-control disposition

Eligibility is calculated from the resource creation timestamp and the currently published policy. A disposition plan is idempotent and contains the pinned policy evidence. Approval must come from a different actor and rechecks legal holds plus current policy identity. This is the **dual-control disposition** boundary.

There is intentionally no `executeDisposition` or deletion adapter in V79. Production shape sets disposition execution to externally controlled, so an approved intent is authorization evidence rather than deletion authority. This is the **no automatic deletion** boundary.

## Production / real-client-data gates

Production requires policy-versioned lifecycle controls, fail-closed holds and externally controlled disposition. Real-client-data mode additionally requires externally reviewed `RETENTION_POLICY_REVIEW_STATUS`, `LEGAL_HOLD_VALIDATION_STATUS` and `DATA_DISPOSITION_PROCEDURE_STATUS` evidence.

No default legal retention period, Co-op retention rule, GDPR interpretation or customer deletion schedule is encoded; those require firm/legal review.
