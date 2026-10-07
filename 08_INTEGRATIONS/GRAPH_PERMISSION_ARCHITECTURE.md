# MICROSOFT GRAPH PERMISSION ARCHITECTURE

## Goal
Enable secure Outlook email ingestion and later controlled actions without asking for unnecessary tenant-wide permissions.

## Core permission facts
### Mail.ReadBasic
Can read basic metadata but not:
- body
- bodyPreview
- attachments
- extended properties

This is insufficient for content classification.

### Mail.Read
Allows reading full mail.
Application permission can read mail without a signed-in user.

### Mail.ReadWrite
Allows creating/updating/deleting mail.
Does not itself include send.

### Delegated permissions
Best where actions should happen only as the signed-in user.
For change notifications, delegated permissions are restricted to the signed-in user's mailbox.

### Application permissions
Required for background firm-wide/shared mailbox monitoring.
Carry greater privacy risk.

## Recommended architecture

### App Registration A — Ingestion Reader
Purpose:
- subscribe to approved mailboxes
- retrieve full messages/attachments

Permissions:
- only Mail.Read if body/attachments required
- restricted to explicitly approved mailboxes

No:
- send
- delete
- mailbox-wide write

### App Registration B — Filing/Write Worker
Only if product needs to update/move/category mail.

Permissions:
- Mail.ReadWrite
- restricted mailbox scope

Keep separate from ingestion identity.

### App Registration C — Outbound Sender
Only if automation sends messages.

Use:
- explicit workflow policy
- human approval for material correspondence
- narrow access

Keep sending authority separated from read authority.

## Admin consent
Enterprise firms will expect:
- clear list of requested permissions
- explanation of why each is needed
- mailbox scope
- revocation procedure
- access logs
- no hidden scope expansion

## Mailbox scoping
Use Exchange/Microsoft controls to limit application permissions to designated mailboxes/users rather than every mailbox in the organisation.

## Change notification design
Subscription:
- /users/{id}/messages or inbox path
- read permission required
- HTTPS endpoint
- validate callback
- store subscription ID
- protect clientState
- renew before expiry
- lifecycle notifications
- handle subscription removal

## Reliability
Never rely on webhooks alone.

Use:
1. webhook
2. enqueue lightweight event
3. fetch canonical message through Graph
4. persist idempotency key
5. process
6. periodically reconcile using delta query

## Security
- token vault
- certificate/managed identity where possible
- short-lived access tokens
- no refresh tokens in client browser
- tenant-specific credentials
- audit Graph operations
- rotate credentials
- emergency revoke

## Sources
Microsoft Graph permission reference
https://learn.microsoft.com/en-us/graph/permissions-reference

Graph permissions best practices
https://learn.microsoft.com/en-us/graph/best-practices-graph-permission

Subscriptions
https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions

Lifecycle events
https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events

Message delta
https://learn.microsoft.com/en-us/graph/api/message-delta
