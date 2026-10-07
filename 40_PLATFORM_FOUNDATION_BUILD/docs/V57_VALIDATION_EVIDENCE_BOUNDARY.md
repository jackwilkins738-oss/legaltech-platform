# V57 — Validation and registry evidence boundary

Status: bounded defect remediation under D-018. Requires corrected V56 (0.10.11)
on main, including its SQLite fixture cleanup correction; produces V57 / 0.10.12.
This remains a read-only synthetic Proclaim validation harness. It adds no live API
implementation, write/send operation, customer credentials, legal rule or migration.

## Owned harness context and input snapshots

Previously public tenant/provider/registry/generation fields could redirect or retire
validation work independently of its original configuration. Tenant identity is now
non-writable/non-configurable. Capability readback returns a copy of actual captured
callable methods. Registry methods, provider read method and its original receiver
are captured at construction. Validation generation uses private per-request tokens.
Public dependency/generation shadows and edits do not alter that private context.

Ordinary/null-prototype constructor, configuration and request options use owned data
descriptors. Inherited records and accessors are rejected without invoking their
getters. Adapter methods may be ordinary inherited class methods; accessor-based
method discovery does not execute the accessor or advertise it as callable.
Changing adapters/methods requires a new harness. Legitimate registry configuration
and permission changes remain visible and retire older validation evidence.

## Provider read proof

History must be a plain dense array of at most 1,000 records. Each record must be
ordinary/null-prototype with owned typed id, tenantId and externalMatterId fields.
IDs must be unique within the response; owner and matter must match the captured
request. Missing indices, index/identity accessors, inherited fields, malformed rows,
foreign records and overridden array helpers cannot prove a read. No automatic
coercion, duplicate removal or partial acceptance is performed.

Only those identity fields and the bounded count are used. Raw provider payloads,
unknown payload accessors and arbitrary failure contents are not evaluated/retained.
Failure uses the existing fixed SYNTHETIC_HISTORY_INVALID/READ_FAILED codes. Empty
valid history and exact 1,000-row responses remain read passes, without proving
completeness/pagination/live semantics. These are synthetic contract limits; a live
adapter still needs authorized admission and representative pagination evidence.

## Private registry and conditional persistence

The registry's connection map is private. Get/list/upsert results are independent
snapshots, while public shadow maps cannot bypass revisions or ownership. Top-level
options and capability arrays reject accessors/inherited/coercible shapes. Metadata
and health are copied as bounded JSON data before mutation. Existing limits remain
256 KiB, depth ten, 5,000 nodes and 1,000 array elements, with aggregate data checked
before serialization. Sparse/custom arrays, symbols, non-enumerable metadata and
unsupported values are rejected instead of silently losing data or executing hooks.
Prototype-shaped keys remain data; no prototype mutation occurs.

updateIfCurrent conditionally writes only when the owned connection ID/revision
still matches the original proof. A stale/missing/mismatched proof returns null
without creating or overwriting a record; malformed proof throws the fixed input
error. Valid updates preserve the connection ID and advance its revision.

Validation checks its private request token and current owned connection snapshot,
then performs that conditional write. It verifies the returned owner/revision and
reads back the exact normalized validation result before reporting persisted=true.
Changed configuration, older replies, stale retrieval or unverifiable acknowledgements
report persisted=false/superseded=true. There is no automatic resend or repair.
A trusted custom registry that commits but returns an unverifiable acknowledgement
may already contain the candidate; the response remains conservative, not proof
that every dependency mutation was rolled back.

## Compatibility and limits

Existing tuple namespaces, capability deduplication, default synthetic targets,
null-prototype data, callable class methods, configuration clearing and revision
retirement remain. Returned records/results remain independent copies. Public
internal-map and mutable authority/dependency fields are intentionally removed as
inspection/mutation interfaces. Use explicit registry/harness methods and snapshots.
Injected registry implementations must support the conditional update contract.

Validation never calls discovered write methods. WRITE_IDEMPOTENCY_CONTRACT and
WRITE_READ_RECONCILIATION remain NOT_TESTED; live API/version/permission evidence
remains BLOCKED. READ_HISTORY PASS is not production readiness. A completed HTTP
validation request records SUCCESS even when its normalized check status is RED;
that audit reports request completion, not successful provider validation.

Input descriptor checks and captured references are not a hostile JavaScript proxy
or same-process runtime sandbox. Injected dependencies/runtime remain trusted.

## Review and delivery

Complete GitHub checks and human security review before merge as required by
`21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`. Review tenant binding,
provider identity/cardinality, private registry state, conditional writes/read-back,
revision retirement and safe HTTP/audit output. No production certification is
claimed. Rollback uses a reviewed Git revert without resetting storage/SQLite.
Native Windows and remote CI remain user-environment checks. See
`../TEST_RESULTS_V57.md` for local evidence.
