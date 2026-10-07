# MICROSOFT GRAPH SPIKE — EXECUTION SPEC

## Question
Can we reliably and securely monitor selected law-firm mailboxes and turn inbound email into durable canonical events without over-privileging the application?

## Scope
Test tenant only.
Synthetic messages only unless explicit customer authorisation exists.

## Current Microsoft facts
Microsoft Graph currently supports Outlook message change notifications for `/users/{id}/messages` and inbox resources. Lifecycle notifications can report `reauthorizationRequired`, `subscriptionRemoved` and missed notifications for Outlook messages. Delta queries provide pull-based reconciliation.

`Mail.ReadWrite` application permission permits read/write mailbox access but does not include send. `Mail.Send` is a separate permission. Draft creation requires `Mail.ReadWrite`.

Sources:
- https://learn.microsoft.com/en-us/graph/api/resources/change-notifications-api-overview
- https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events
- https://learn.microsoft.com/graph/delta-query-overview
- https://learn.microsoft.com/en-us/graph/permissions-reference
- https://learn.microsoft.com/en-us/graph/api/user-post-messages
- https://learn.microsoft.com/en-us/graph/api/user-sendmail

## Spike architecture
Exchange Online
→ change notification
→ validation endpoint
→ durable queue
→ message fetch
→ attachment fetch
→ canonical event
→ processing state

Separate lifecycle endpoint/handler:
→ renew / recreate subscription
→ delta reconciliation

## Required proof

### G-01 Subscription
Create subscription for one explicitly approved test mailbox.

PASS:
- validation succeeds;
- subscription ID persisted;
- expiration persisted;
- client state stored as secret/reference.

### G-02 Receive event
Send synthetic email.

PASS:
- webhook arrives;
- notification accepted quickly;
- expensive processing happens asynchronously.

### G-03 Fetch message
PASS:
- sender, recipients, subject, body, timestamps, stable external IDs retrieved.

### G-04 Attachments
PASS:
- attachment list fetched;
- binary retrieved only through server-side credential;
- attachment can enter quarantine pipeline.

### G-05 Duplicate delivery
Replay same notification.

PASS:
one canonical event / no duplicate downstream action.

### G-06 Missed-event reconciliation
Simulate missed event or start from delta checkpoint.

PASS:
delta query discovers missing/changed message without full mailbox replay.

### G-07 Subscription removal / expiry
PASS:
lifecycle event or monitoring causes subscription to be recreated/renewed.

### G-08 Permission restriction
Application cannot read an out-of-scope mailbox.

PASS:
denied at Microsoft/Exchange scope, not merely hidden in our UI.

### G-09 Token loss
Revoke credential/consent.

PASS:
connector reports degraded state; no silent data loss claim.

### G-10 Deletion/move
Move/delete test message.

PASS:
sync/reconciliation behavior documented.

## Non-goals
- production UI
- autonomous sending
- full multi-tenant administration
- customer mail

## Output artifact
GRAPH_SPIKE_RESULTS.md:
- tenant/app config
- permissions
- endpoint/resource
- tests G-01..G-10
- screenshots/log references
- failures
- architecture changes required

## Pass gate
At least G-01 to G-08 pass or have a clearly supported remediation.
