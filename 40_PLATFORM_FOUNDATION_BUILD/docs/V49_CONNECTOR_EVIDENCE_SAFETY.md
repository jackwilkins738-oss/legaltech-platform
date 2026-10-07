# V49 combined connector evidence safety batch

Defect-only work on the existing synthetic connector control plane, based on V48.
D-018 and human security/live-connector evidence gates remain unchanged.

## Reproduced defects and changes

- Proclaim validation returned arbitrary adapter exception text, also retaining it
  in registry snapshots. Failures now use fixed bounded reasons. History must be
  an array of records with valid IDs and the requested tenant/matter binding;
  malformed or foreign history cannot produce a passing read check. Targets are
  validated before I/O; a missing/non-mock connection denies the operation.
- Static write/idempotency and reconciliation assertions were marked PASS without
  executing tests. Both are now NOT_TESTED. Live checks remain BLOCKED. Only a
  successful owned synthetic history read can PASS, including an empty array.
  Capabilities describe callable adapter methods, not unimplemented functions or
  live permissions. Configuration alone is UNVERIFIED; successful read evidence
  leaves the connection VALIDATION_INCOMPLETE / READ_ONLY_VALIDATED, never GREEN.
  Revoked read capability is retained and prevents adapter reads.
- In-flight results could overwrite newer results/configuration, and reconfiguration
  retained old validation evidence. Each connection has a monotonic revision and
  validation uses a generation fence. Only the current generation/revision can
  persist. Superseded responses are explicitly marked; reconfiguration clears old
  validation evidence. Invalid reconfiguration leaves an active valid check intact.
- Registry records held nested caller aliases and could mutate before clone failures.
  Inputs now require typed bounded identifiers/capabilities and JSON-safe metadata/
  health. Validation and deep cloning happen before mutation. Original arguments,
  returned results and snapshots cannot change stored evidence. Tuple registry
  keys prevent tenant/kind delimiter aliasing; revisions advance only on success.
- Graph checkpoint token values were returned and rendered verbatim. Mutation
  receipts and snapshots now expose checkpoint presence/scope only; the internal
  model retains the opaque token. Revoked checkpoint-only scope is DEGRADED and
  visible as OUT_OF_SCOPE. Invalid mailbox configuration fails closed rather than
  crashing snapshots. Opaque input controls are rejected before mutation.

The operator view does not render legacy token fields and cannot present failed,
stale or unproved validation as a success. It explains that write/live evidence
remains unverified after a successful synthetic read.

## Compatibility and limits

No schema migration, dependency, production access, legal rule or live call.
Proclaim validation stays read-only; it does not execute writes to manufacture
proof. Read responses must follow the current synthetic adapter shape. Raw failure
text is omitted; inspect the bounded failure reason and separate authorized tools
rather than rely on connector snapshots as provider diagnostics.

Graph setDelta/snapshot no longer return deltaCheckpoint/token fields. Consumers
use checkpointPresent/scopeStatus. Opaque tokens remain in this in-memory harness;
this is not a durable Graph implementation or a live Graph protocol claim.

Registry metadata/health require plain JSON records, at most 256 KiB for the full
record, depth 10 and 5,000 nodes; arrays are limited to 1,000 elements. Capabilities
are bounded strings and snapshots are isolated copies. Unsupported values, cycles
and accessors fail before mutation. Revisions/generations are local in-memory
fences, not cross-process/distributed locks, and reset with the existing harness.
Caller-provided configuration is still not proof of authorized live permissions.

## Verification and delivery

Platform: 409/409, including 57 new cases; earlier Node, inventory/security,
lint/catalog and whitespace checks also pass. Tests cover malformed/foreign reads,
error redaction, honest check status, method capabilities, revocation, concurrent
completion order, reconfiguration, alias isolation, atomic rejection, JSON limits,
checkpoint secrecy/scope, actual HTTP responses and rendered operator behavior.

The installer requires V48 app version 0.10.3 and an exact applicable clean patch.
It optionally commits/pushes feat/connector-evidence-safety-v49 without resetting,
force-pushing or merging. LF/Windows checkout-ending fixtures exercise installation,
scoped publication and repeats against local bare remotes. Native PowerShell and
GitHub CI remain user-side checks; human security review is required before merge.
Rollback uses a reviewed Git revert and does not reset runtime data. Reverting
restores the old evidence/token behavior, so review that consequence explicitly.
