# V159 — Support operator policy review

Status: SECURITY REGRESSION / OWNER REVIEW; no remediation or acceptance of risk.

Issue #80 identifies a possible interaction between migration 025's PUBLIC tenant-only permissive INSERT policies and migration 061's operator actor-bound permissive policies. This batch probes all four tables through the actual restricted operator login with tenant and actor transaction context set by the existing transaction driver.

The expected invariant is database rejection when requester_id, approver_id, revoked_by or event actor_id differs from the transaction actor. Every probe is rolled back unconditionally, even if accepted, and all accepted operations are reported by one final failing assertion. The test uses only existing synthetic fixtures and no customer data. A failed run is evidence for review; do not weaken its assertions or merge this branch merely to clear CI.

Remediation requires a new reviewed migration, preserved old checksums, explicit policy composition, current-role binding and negative tests. This batch deliberately makes no grants or policy changes. Support consumer adoption remains blocked pending review; D-018, pre-TO/customer-data and V131 restrictions remain unchanged.
