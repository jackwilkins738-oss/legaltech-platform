# V46 combined HTTP boundary safety batch

This defect-only batch builds on V45. It expands no legal workflow or production
access and retains the D-018 stop line and human security review requirements.

## Reproduced defects and changes

- Noncanonical UTF-8 bytes inside otherwise valid JSON previously became replacement
  characters and reached ingestion. The HTTP reader validates the complete bounded
  byte sequence before JSON parsing; malformed input returns INVALID_JSON (400).
- Malformed percent-encoded route IDs previously raised URIError and returned 500.
  All resource-ID routes now decode through one guarded helper and return
  INVALID_REQUEST (400) before resource lookup or mutation. Invalid URL parsing
  uses the same safe client-error classification.
- Duplicate Authorization and Idempotency-Key headers previously reached routing:
  Authorization could silently use one value and keys could combine ambiguously.
  Raw header names are counted without case sensitivity; duplicate occurrences,
  including identical values, return INVALID_REQUEST (400) before authentication.
- Unexpected exceptions previously controlled public status and code; an adapter-
  shaped error with status 400 also exposed its message. Only errors created by
  appError have a privately recorded public envelope. Unexpected thrown values
  return INTERNAL_ERROR (500); trusted server errors retain valid server status
  but redact code/message. Invalid trusted status/code metadata also fails closed.
  Original trusted envelopes are immutable even if error properties change.
  Connector mutation audit failure reasons use this same public classification.

## Evidence and boundaries

39 new network tests exercise actual loopback HTTP: malformed UTF-8, all matched
resource-ID route families, duplicate security headers, private exception metadata,
primitive/null throws, integration audit redaction, trusted conflict preservation,
metadata tampering, exact/oversize bodies, valid split multibyte data and aborts.
The 1 MiB limit, normal authentication/capabilities and tenant checks are unchanged.
Oversize and aborted-request checks are regression coverage, not newly claimed
fixes. Synthetic fixture callbacks record lookup/mutation attempts; existing API,
SQLite, tenant, writeback and recovery tests also run unchanged.

No new dependencies or schema migrations. Existing clients using one security
header and valid UTF-8 continue to work. Custom auth/adapter callbacks must create
intentional client failures with appError; arbitrary error.status/code properties
are no longer a public contract. Internal exception details are not logged by this
batch. The synthetic server is not a production proxy, malware scanner or live
connector validation.

## Delivery and rollback

The installer requires V45 app version 0.10.0 and an exact applicable Git patch.
It preserves unrelated work, validates all suites and catalog/security checks,
and optionally commits/pushes feat/http-boundary-safety-v46. It performs no resets,
force pushes or merges. Node updater fixtures cover LF/Windows checkout endings,
repeat installs/publication and local-edit guards; PowerShell execution itself
requires the user's Windows environment because pwsh is unavailable here.
Review before merging; rollback through a reviewed Git revert, without changing
SQLite data. Older versions restore the documented boundary defects.
