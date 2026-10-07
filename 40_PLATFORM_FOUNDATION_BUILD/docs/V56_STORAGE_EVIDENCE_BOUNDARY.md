# V56 — Storage and attachment evidence boundary

Status: bounded defect remediation under D-018. Requires merged V55 (0.10.10);
produces V56 / 0.10.11. This extends the existing V47 synthetic attachment/storage
checks without adding a scanner, parser, live provider or legal workflow.

## Storage evidence before acknowledgement

Previously get ignored sidecars entirely, and deduplicated put checked only their
file type. Missing, malformed or foreign metadata could therefore accompany an
acknowledged object. Get and put now verify owned bytes against the reference hash,
and require a bounded JSON sidecar whose tenant, hash and size match those bytes.
The content type and metadata shape must be typed; JSON must be valid UTF-8.
The sidecar has the existing five-field envelope. Unknown envelope fields or
inconsistent records fail rather than being rewritten. Missing binary data still
returns null on get; missing metadata for present bytes is a storage failure.

New metadata is copied through owned data descriptors before any file creation.
Plain/null-prototype records, dense arrays, finite numbers, strings, booleans and
nested null values are supported. Accessors, callable toJSON/functions, unsupported
values, sparse arrays and excessively deep/large data are rejected without invoking
serialization callbacks. Limits are 64 KiB for the complete sidecar, depth eight
and 8,192 visited nodes; aggregate input data is also bounded before serialization.
Direct storage accepts Buffer/Uint8Array bytes, copies them and retains the existing
15 MiB ceiling. Non-byte/coercible values and malformed option records are rejected.

## Fixed namespace and bounded reads

The configured root is resolved once and becomes an immutable public value backed
by a private path and captured directory identity. Deliberately configuring a root
link remains supported, but subsequent property edits cannot redirect operations.
Observed root/tenant directory replacement, links and nonregular object/sidecar
paths fail closed.

Reads open a descriptor, compare exact BigInt file identity/size/timestamps, and
read at most the initially observed size plus one byte within the fixed ceiling.
The descriptor and named path are rechecked after reading, followed by directory
identity checks. Descriptor cleanup runs on both success and failure. Unix platforms
use O_NOFOLLOW when available; Windows relies on identity/type checks rather than
that flag. All returned bytes also satisfy the reference hash. These checks reject
the observed redirects tested here; they are not isolation from a hostile process
that can arbitrarily replace directory trees or forge a coherent filesystem state.
Protect the root with OS permissions. Native Windows behavior remains unverified locally.

## Basic inspection and processing

Basic inspection quarantines malformed records/accessors, non-byte inputs, invalid
size budgets and empty/control-character/dot-only filenames. Its hard ceiling
remains 15 MiB; a valid tighter budget, empty explicit bytes, Uint8Array input and
ordinary safe trailing-dot names remain supported. Existing executable-extension,
path/colon-alias and executable-magic rules remain. A SAFE_FOR_PARSER result proves
only these synthetic basic checks, not malware safety or safe parsing.

The existing worker verifies attachments before classification and before result
commit. Sidecar loss/corruption and newly invalid historical filenames now fail
those checks: no approvable transition, exception creation or completion audit.
Already completed human outcomes are not retroactively reclassified. Quarantined
files keep the existing FILE_SAFETY review path without loading their bytes.

## Compatibility, failures and investigation

Valid historical pretty/compact sidecars and reference formats remain readable.
Deduplication preserves the first valid sidecar, including its filename/content type;
the returned put descriptor describes the current input, not a metadata rewrite.
No schema migration, reset, counter normalization or automatic repair occurs.
An object with only one half of its binary/sidecar pair cannot be repaired by retrying
put. Authorized investigation/restoration is required before ordinary retry.

Filesystem and SQLite are not one atomic transaction. A later file/metadata/database
failure can leave unreferenced files; this batch does not delete them or claim atomic
multi-file rollback. It prevents acknowledgement of incomplete pairs and preserves
existing corruption. Failed ingest still rolls back acceptance rows, jobs, audit and
cache through the existing database transaction. Restoring original owned evidence
allows normal processing retry without duplicate acceptance or a new job.

Plain-record/accessor checks are not a hostile JavaScript proxy sandbox. Injected
filesystem/runtime infrastructure and root OS permissions remain trusted boundaries.

## Required review

Complete GitHub checks and human security review before merge as required by
`21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`. Review sidecar binding,
bounded reads/cleanup, namespace checks, filename/budget behavior and historical
compatibility. Rollback uses a reviewed Git revert; it does not delete stored objects
or reset SQLite. See `../TEST_RESULTS_V56.md` for local evidence and pending checks.

## Installer/fixture correction after Windows feedback

The original Windows run stopped on 12 fixture cleanup hooks, not reported storage
assertions: temporary-directory removal ran before SQLite close. The shared test
fixture now owns its stores and closes them before removing its directory. This
changes test lifecycle only; storage policy and runtime source are unchanged.
The corrected installer recognizes either the exact original V56 source manifest
or the exact corrected manifest. It applies the narrow correction only to the
original manifest, preserves unrelated work by stopping, and supports scoped V56
changes carried onto main. An existing V56 branch is reused from main only when
its HEAD matches the current HEAD; no branch reset, overwrite or force push occurs.
All checks still gate publication. Unknown/mixed V56 source is not repaired blindly.
