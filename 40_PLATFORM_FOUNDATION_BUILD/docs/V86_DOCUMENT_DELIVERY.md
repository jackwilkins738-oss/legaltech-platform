# V86 — Secure document delivery

V86 adds a workflow-agnostic boundary for delivering an individual authorized document to an authenticated user without exposing a reusable object-storage reference to the browser.

## Delivery model

A grant is issued only after current matter and document authorization succeeds. The grant is short-lived, actor-bound, tenant-bound and indirectly matter/document-bound through cryptographic hashes. The raw storage reference is not persisted in the grant or delivery-event evidence.

On redemption the server resolves the document again, re-runs current authorization, verifies the document binding is unchanged and reads the object through the protected storage adapter. This means revocation, matter-security changes or document replacement invalidate an already-issued grant.

The reference implementation returns bytes to the server call surface; it deliberately does not create public URLs or hand object references to clients. `ALL_EGRESS` security interlocks also stop document delivery.

## Production shape

Migration `023_document_delivery.sql` defines immutable issuance evidence, unique single-use consumption evidence and append-only delivery events. Evidence is tenant/matter/actor bound and contains hashes instead of raw object references or bearer tokens.

Production requires:

- `DOCUMENT_DELIVERY_MODE=server-resolved`
- `DOCUMENT_DELIVERY_GRANT_MODE=actor-matter-single-use`
- `DOCUMENT_DELIVERY_PUBLIC_LINK_MODE=disabled`

Real-client-data readiness additionally requires `DOCUMENT_DELIVERY_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

The in-memory grant registry is a reference implementation, not a production distributed replay store. V86 does not select a CDN, object-storage vendor, HTTP streaming framework or document-viewer UI. Production must back single-use grant consumption with durable shared state represented by the production migration.
