# V41 inbound request and replay safety

Lifecycle: current synthetic defect remediation under D-018.

## Reproduced V40 failures

The same ingest key silently replayed the first event when content changed.
Delimiter-qualified tenant/key pairs could collide and return a foreign event ID
and trace. Invalid base64 was silently decoded as an empty/truncated attachment;
wrong attachment types could produce internal errors or enter stored metadata.

## Current contract

- New ingest scopes use an unambiguous serialized tuple of operation, tenant and
  key. Before any replay, event and original processing job ownership are verified.
  Returned IDs/trace are reconstructed from those resources, not trusted cache text.
- Acceptance stores a versioned SHA-256 fingerprint of source system, external event
  ID, subject, body and ordered attachment metadata/byte hashes. Quarantined bytes
  also participate without being stored or passed to a parser.
- The same key and normalized content replays without a second event, job or audit.
  Changed content returns HTTP 409 `IDEMPOTENCY_CONFLICT`, without mutation.
- Omitted defaults and JSON property order do not change identity. Text and base64
  uploads producing identical bytes/metadata share the same identity. Attachment
  order, count, filename, content type and bytes are significant.
- Domain and HTTP paths share input validation. Wrong types, blank/control/path
  filenames, invalid external IDs, ambiguous text-plus-base64 content and malformed
  base64 return HTTP 400 before storage/database acceptance.
- HTTP base64 must be standard canonical padded base64: no whitespace, URL-safe
  alphabet, omitted required padding or nonzero padding bits. Empty base64 is valid.
- Synthetic request limits: at most 100 attachments; filename/content type at most
  255 characters, external event ID at most 512, subject at most 4096 and body at
  most 1 MiB characters. Existing total HTTP body limit remains 1 MiB bytes.
  These are development bounds, not validated real connector limits.
- Filenames must be leaf names. Missing content type defaults to
  `application/octet-stream`; present non-null content type must be nonempty text
  without control characters. MIME/content authenticity is not proven by metadata.

## Upgrade and historical replay

No schema migration or reset is needed. Fingerprints are held in existing event
JSON and new scopes in the existing idempotency table. Old cached results are read
only after verifying tenant ownership and event/job linkage.

A legacy request without attachments can be checked using preserved event fields,
then upgraded transactionally. A legacy request with attachments cannot be fully
reconstructed because the original byte/MIME identity was not preserved. It returns
HTTP 409 `IDEMPOTENCY_UNVERIFIABLE` and leaves the original event untouched. Do not
change the key to bypass this response: that can create duplicate inbound work.
Inspect the original event before deciding what to do. No automatic resend occurs.

Historical malformed fields and missing event/job records are not repaired. Existing
state remains available to its authorized readers. The updater refuses dirty edits
and requires updated `main`, creating `feat/inbound-request-safety-v41` for review.

Avoid reverting to V40 ingest while retrying V41 keys: the old worker does not know
new scope identities. Pause inbound acceptance and prefer a forward fix; preserve
the database before rollback. Existing V39/V40 writeback/transaction guarantees
remain intact. No real Graph/Proclaim, production SSO or legal workflow is added.
Human security review remains mandatory before merge.
