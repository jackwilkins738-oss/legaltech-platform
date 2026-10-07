# V48 combined decision and recovery safety batch

Defect fixes in the existing synthetic approval, review, recovery and writeback
path, based on V47. D-018, human review and production evidence gates remain.

## Reproduced defects and changes

- Approval replay previously trusted cached job/result fields and ignored actor
  changes. New four-element tuple scopes avoid tenant/key delimiter collisions and
  separate approval records from the existing three-element cache domains. Inputs are
  bounded and control-free; replay proves owned event, matter, exception, job and
  durable writeback command, including actor, classification and trace. Results
  are reconstructed and fingerprinted rather than returning arbitrary cache data.
  A missing cache cannot allow a new approval to overwrite another command.
- REVIEW_REQUIRED could be approved directly without resolving its exception.
  It now requires the open owned exception; a current processing exception binding
  must match. READY_FOR_APPROVAL still supports the existing direct synthetic
  approval path. The resolved exception ID is retained on the new approval record.
- Attachment loss/corruption after processing previously allowed approval.
  First approval checks the V47 owned bytes again before authorizing a queue entry.
  Failure returns ATTACHMENT_UNAVAILABLE (409) without changing the decision/job.
  Original-byte restoration permits a same-key retry. Already recorded decisions
  are not reopened, and cache replay does not retroactively recheck attachments.
- Recovery replay ignored actor changes and returned cached extra fields/counts.
  New requests fingerprint event/actor and bind proof to the queued job. Replay
  checks ownership, trace, actor and proof and reconstructs the original receipt.
  Recovery counters and attributable identifiers are bounded before mutation.
- Writeback execution previously accepted command actor/classification/trace drift.
  The worker checks these against the approved event and job before external I/O.
  Failure uses the existing bounded worker error/retry path without an external
  send. Cached review approval also checks the complete original approval proof.

## Compatibility and historical records

Direct approval keeps the existing synthetic-reviewer default. Replays must use
that original actor; silently retrying another actor's key now conflicts. Effective
matter/exception identity is bound, so omission and the same proven target can
replay. Public review keys still allow 200 characters; the internal resolve: prefix
is explicitly supported by the 208-character approval limit.

Legacy approval cache upgrades only when existing owned event/matter/job/command
and resolved-exception evidence proves its identity. An unresolved original
exception or ambiguous historical exception evidence fails closed. The historical
cache is preserved; the tuple cache receives the proved receipt/fingerprint in one
transaction. Unverifiable old recovery requests return IDEMPOTENCY_UNVERIFIABLE;
existing queued work is retained and can run. A fresh recovery key is permitted
only by the existing exhausted/stalled-work gate, never to stack active work.
Replay receipts describe original acceptance, not the current worker status.

No schema reset, dependency, legal rule, automatic repair, live connector or new
production access. Existing security and tenant/capability boundaries remain.
Approval does not create a new HTTP route; the current exception resolution route
uses this guarded domain operation. Human-reviewed quarantine behavior remains.
SQLite fault tests prove atomic rollback of decisions, caches, jobs and audits;
filesystem availability retains the V47 storage/OS limitations.

## Verification and delivery

Platform: 352/352, including 59 new tests. Coverage includes malformed input,
cache/resource/command corruption, delimiter isolation, attribution, resolved
exception gates, attachment restoration, legacy upgrade and rollback, maximum
review key length, unsafe recovery counts, actual HTTP actor retries and dispatch
proof checks. Earlier Node, inventory, security, lint/catalog and whitespace checks
also pass. Native Windows link fixture limitations from V47 still apply.

The installer requires V47 app version 0.10.2 and a matching clean checkout.
It validates and optionally commits/pushes feat/decision-recovery-safety-v48,
without reset, force push or merge. LF/Windows checkout-ending fixtures test
application and repeat publication against local bare remotes. PowerShell itself,
GitHub CI and human security review still require the user's environment/review.
Rollback uses a reviewed Git revert and preserves runtime data.
