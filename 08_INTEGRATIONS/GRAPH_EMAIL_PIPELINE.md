# GRAPH EMAIL PIPELINE DESIGN

## Target flow

Exchange Online
→ Graph Change Notification
→ Public webhook
→ validation + clientState check
→ event queue
→ Graph fetch
→ dedupe/idempotency
→ malware scan attachments
→ email parser
→ matter matcher
→ document classifier
→ extraction
→ workflow action detector
→ risk/approval policy
→ Proclaim write-back / platform data
→ audit record

## Important design rule
Webhook payload should be treated as notification, not necessarily source of truth.
Fetch the resource from Graph using controlled credentials.

## Reliability controls
- queue before doing expensive work
- respond quickly to Microsoft
- retries
- DLQ
- subscription renewal
- lifecycle events
- delta reconciliation
- dedupe by stable IDs
- replay protection
- per-mailbox checkpoint

## Matter matching confidence
Signals:
- explicit case number
- sender
- recipient
- conversation
- previous mappings
- client
- opponent
- file contents
- court/claim references

## Confidence policy example
99%+:
automatic filing for proven low-risk pattern

90–99%:
auto-suggest, human quick confirmation

<90%:
manual review

Do not hard-code these values until evaluation data exists.

## Data minimisation
Do not indiscriminately sync every mailbox.
Allow customer to select:
- specific shared inboxes
- teams
- users
- folders

## Outbound action
Separate:
draft generation
from
sending.

For early product:
AI drafts → authorised user sends/approves.
