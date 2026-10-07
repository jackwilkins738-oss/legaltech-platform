# V40 durable inbound safety

Lifecycle: current bounded defect remediation under D-018. Synthetic data only.

## Reproduced failures

V39 could save an inbound event, job and idempotency result before acceptance audit
failed. A processing audit/completion failure could leave a review exception behind;
retry created another exception. A delayed classifier could overwrite a later human
decision. Worker responses and durable job errors included raw provider error text.

## Changed behavior

- Event acceptance, queue insertion, idempotency result and acceptance audit commit
  in one synchronous SQLite transaction. Failure leaves no accepted database state.
- Classification runs outside the SQLite transaction. Event update, review exception,
  processing audit and job completion then commit together. On failure the event
  remains queued and retry cannot inherit a partial review.
- The worker re-reads current event state before committing classification. Duplicate
  jobs skip already processed events, preserve approval/rejection/writeback state and
  do not repeat classification, review creation or processing audit.
- New events record processing metadata with the existing exception ID. Historical
  processed events without that metadata are preserved; no backfill is performed.
- Malformed classifier status, classification or confidence cannot produce an
  approval-ready event. Processing failures remain bounded to three attempts.
- New worker failures return and persist only `INBOUND_PROCESSING_FAILED`, without
  copying provider messages, document text, credentials or filesystem paths.
- The synthetic scenario UI requires a successful processing result for exactly the
  selected event before announcing review-pipeline success.

The HTTP API shape, capabilities and tenant-derived worker selection are unchanged.
Human approval remains necessary before external writeback.

## Upgrade and operating limits

No schema migration, data reset, commit, push or merge is performed by the updater.
Stop the local server before applying. Use a clean `main` checkout; the updater
creates `feat/inbound-safety-v40`, verifies tests and rebuilds the file catalog.
Existing V39 writeback recovery behavior is preserved.

This update does not repair historical duplicate exceptions, previously partially
accepted events or previously stored raw error text. Inspect such synthetic data
before making review decisions; do not blindly approve duplicate items.

SQLite transactions do not roll back filesystem object writes. A failed acceptance
may leave a tenant-scoped content-addressed object without an event reference. It
remains unavailable through event APIs and can be reused on retry. No automatic
object deletion is added because other events may share the same object.

An exhausted inbound job remains dead; no unattended restart or manual recovery
endpoint is added. Multi-host leases, production storage, real AI, Graph and
Proclaim behavior are not validated. Human security review is required before merge.
