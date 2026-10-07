# PROCLAIM TECHNICAL VALIDATION MATRIX

## Objective
Replace "Proclaim probably supports this" with a binary, tested capability matrix.

## Environment facts to capture

### Product/environment
- Proclaim version
- desktop / Evo usage
- hosted by whom?
- database platform/version
- modules licensed
- REST available?
- SOAP available?
- web services licensed?
- test/non-production environment?
- Task Server?
- Document Server?
- accounts module?
- Microsoft 365 / Outlook configuration
- current custom integrations

### Access
- API documentation available?
- API credentials obtainable?
- dedicated integration/service user possible?
- least-privilege access configurable?
- IP restrictions?
- endpoint allowlisting?
- VPN/private networking?

---

# Capability tests

For every test record:
- supported? YES/NO/PARTIAL
- official/supported method?
- required permissions/module?
- request latency
- result
- failure mode
- read-back verification
- version limitation
- support implication

## Read capabilities

### P-READ-01 — Find matter by exact matter ID
PASS:
Returns correct matter and stable identifier.

### P-READ-02 — Search matter by client/reference
PASS:
Returns scoped candidates without unrelated data exposure.

### P-READ-03 — Read selected matter fields
Test:
client, case type, handler, status, custom field.

### P-READ-04 — Read history
Need:
history items + timestamps + document references where possible.

### P-READ-05 — Retrieve document
Need:
metadata + binary/content path through supported method.

### P-READ-06 — Read task/diary state
If supported.

---

# Write capabilities

## P-WRITE-01 — Create history note
Must prove:
write → read back → unique external ID.

## P-WRITE-02 — File inbound email
Need:
subject/body/sender/date/attachments/metadata.

## P-WRITE-03 — Upload document
Need:
filename, binary, document metadata, matter association.

## P-WRITE-04 — Create task/action
Need:
type, owner, due date, description.

## P-WRITE-05 — Update safe field
Use non-critical test field.

## P-WRITE-06 — Create/update document history metadata

---

# Reliability tests

## P-REL-01 — Duplicate request
Can the connector prevent duplicate history/email/task creation?

## P-REL-02 — Timeout after write
Can we determine whether action actually occurred?

## P-REL-03 — Proclaim unavailable
Does action safely queue/retry?

## P-REL-04 — Invalid matter
Does it fail clearly without side effects?

## P-REL-05 — Permission denied
Does connector surface a distinct, safe error?

## P-REL-06 — Concurrent update
Can we detect stale state / overwrite risk?

---

# Throughput tests
Only in authorised test environment.

Measure:
- reads/minute
- writes/minute
- document sizes
- API latency
- concurrent request behavior

We do NOT need production-scale load testing tomorrow.
We need enough to identify obvious architectural limits.

---

# Capability grades

## GREEN
Officially supported, repeatable, safe.

## AMBER
Possible but awkward / partially documented / requires workaround.

## RED
Unsupported, unreliable or too risky.

## UNKNOWN
Not tested.

---

# Technical gate for inbound wedge

Minimum acceptable:
- Matter lookup = GREEN/AMBER
- History/document write = GREEN/AMBER
- Email/document filing = GREEN/AMBER
- Read-back/reconciliation = GREEN
- Duplicate prevention at our adapter layer = GREEN

Task creation and field update are valuable but not mandatory for the first read/file pilot if workarounds exist.

---

# Immediate stop signals

Pause the current augmentation design if:
- no supported way to associate documents/email with matters;
- API rights require unacceptable full-admin access;
- writes cannot be reconciled after timeout;
- production support contract forbids required integration path;
- Evo migration will imminently invalidate the connector strategy.

In that event, investigate:
- read-only augmentation,
- Microsoft-first workflow,
- customer-side adapter,
- Evo-native integration,
- alternative wedge.
