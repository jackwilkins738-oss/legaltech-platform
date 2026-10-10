# V158 — Support authority process and transaction evidence

Status: synthetic integration verification; CI execution required before merge.

Two independent Node processes use separate restricted PostgreSQL reader pools to observe one approved diagnostic grant. Both must deny cross-tenant or incorrect-scope requests and deny the grant after a separately connected operator commits revocation. A newly started reader must also deny the revoked grant. The test checks distinct process IDs and the exact REQUESTED, APPROVED, REVOKED event sequence. Child workers receive only synthetic reader credentials, never the parent's admin credentials.

A separate integration test rejects the final live-session check during each request, approve and revoke transaction. It verifies that both the mutation row and its event roll back together in actual PostgreSQL. A denied revoke is not a completed revocation and must not be reported as one.

These tests do not establish a cross-server handoff fence, consumer adoption, live identity-provider revocation or deployment readiness. Security concern #80 (effective actor-binding under permissive policy composition) remains open for owner review and blocks support consumer adoption. D-018, pre-TO/customer-data restrictions and V131 remain unchanged. No migrations, production grants, dependencies or workflows change.

Rollback: revert this test-only batch. Existing runtime behavior remains unchanged.
