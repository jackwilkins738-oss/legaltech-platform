# V51 combined inbound evidence safety batch

Defect-only work on the existing synthetic inbound/approval/writeback path, based
on V50. D-018, pre-TO scope and human security/live integration evidence gates remain.

## Classifier boundary and minimization

The worker accepts plain data records with own data properties for status,
classification, confidence and model. Required-field accessors, inherited fields,
arrays/class instances, unknown labels/models and inconsistent combinations fail
with the existing bounded INBOUND_PROCESSING_FAILED retry/dead-letter behavior.
Confidence remains a finite number in [0,1]; no auto-action threshold is introduced.

The recognized existing synthetic combinations are:

| Status | Model identifier | Classifications |
| --- | --- | --- |
| OK | deterministic-classifier-v1 | GENERAL_CORRESPONDENCE, MEDICAL_CORRESPONDENCE, OFFER_CORRESPONDENCE |
| BLOCKED | deterministic-safety-v1 | UNTRUSTED_INSTRUCTION |

Only these four validated fields and an application-owned reason are stored or
returned. OK reason is synthetic_rules_only; BLOCKED reason is
untrusted_classification. Arbitrary provider reasons, tool calls, echoed contexts,
additional metadata, cycles and irrelevant getters never reach event/exception
serialization. Required-field getters are rejected without invocation; irrelevant
getters are ignored. Normalized source text is the only gateway input, not matter
records, other tenant data or arbitrary event metadata.

These identifiers define the existing local mock contract. A name supplied by an
adapter is not identity attestation, live model authorization or accuracy evidence.
A different model/version/taxonomy still requires the existing human evaluation and
admission process before this contract can change. The deterministic classifier's
rules are unchanged. Eight fixed synthetic samples exercise this contract; they do
not establish real document accuracy, calibration or robust prompt-injection defense.
All external actions still require an explicit human decision.

## Source and result evidence

A source fingerprint captures owned IDs/trace, source system/external event,
subject/body, attachment evidence and original ingest fingerprint before the async
classification call. After the call, a queued event must still match that source;
changed context or added quarantine cannot inherit an earlier ready result.
Failure retains the new source, bounded retry and no new exception/audit. A retry
classifies the current source and verifies owned attachment bytes again.

New completed work records evidenceVersion v51 and a fingerprint binding that
source, normalized classification and deterministic match. First approval and every
writeback command validation check it again. Changed source, match, classification,
missing fingerprint or unknown evidence version cannot authorize a send. First
approval returns 409 CLASSIFICATION_UNAVAILABLE; worker failure stays bounded as
WRITEBACK_INTERNAL_ERROR. Previously recorded approval request replays remain receipts
of the original decision; replay does not authorize a new send or bypass dispatch.

Fingerprints use stable JSON key ordering, preserve array ordering, and survive
restart and ordinary decision/writeback status updates. Attachment byte integrity
remains independently enforced by V47/V48 controls. Fingerprints provide consistency
checks in the trusted local database, not authentication against someone who can
rewrite all data and recompute/remove provenance.

## Current owned matter proof

Matching runs against current references inside the processing transaction after
classification. Each candidate must have valid owned ID/external ID/reference
metadata and agree with its current tenant-scoped matter lookup. Any unverifiable
index/candidate forces review without exposing foreign candidates, even if another
valid candidate exists. Deletion, changed reference metadata or newly conflicting
references cannot leave an old AUTO proposal. First approval and dispatch also
check the target matter's stored tenant identity. Existing explicit human matter
selection and correction remain available; no probabilistic matching is added.

## Inbound claims and atomic outcomes

Before I/O and every commit, the worker checks event ID/tenant/trace and the claimed
job's tenant/type/attempt/trace/full payload. Conditional claimed-job completion and
failure replace unrestricted job updates. Retired or changed claims return
SUPERSEDED with a small nested superseded result for existing callers; late provider
failures cannot requeue DONE/CANCELLED jobs or overwrite a replacement attempt.
Changed job metadata is preserved for operator investigation, not repaired silently.

Processing, exception creation, fingerprint, audit and job completion still share
one transaction. Failed/lost completion rolls back the entire processing outcome.
Already processed event replay and recorded human decisions skip another AI call.
The earlier fault fixtures now inject at completeClaimedJob, the actual conditional
completion boundary, rather than the obsolete unrestricted completeJob helper.

## Historical behavior and delivery

Recognized historical synthetic classifications without new provenance retain their
existing human approval path and file checks. Unsupported/missing model evidence
cannot authorize a new approval or dispatch. Previously stored raw classifier
metadata is not rewritten by this batch; new outcomes are minimized. Legacy events
are not backfilled with invented fingerprints. Already processed replay preserves
original records. Any queued noncanonical source is rejected before classification;
use authorized operator review/re-ingest rather than automatic repair.

`npm run demo` now declares the supported MANUAL source for synthetic injection and
completes human approval plus mock write/readback. It does not claim a real Graph call.

App 0.10.6 / badge V51; branch feat/inbound-evidence-safety-v51. Apply only to clean
updated V50 main (0.10.5), after review/merge. Installer scope/hash/branch protections,
all five Node suites, Python inventory/security/catalog checks, safe repeats and
optional scoped commit/push remain. No reset, force push or automatic merge occurs.
Native PowerShell/GitHub CI/human review and live integration evidence remain pending;
Linux fixtures with Windows checkout endings do not prove native Windows execution.
