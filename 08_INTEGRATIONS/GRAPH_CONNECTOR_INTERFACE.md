# MICROSOFT GRAPH CONNECTOR INTERFACE

## Identities
Reader
Writer
Sender
kept logically separated.

## Interface

createMailboxSubscription(mailboxId, folder?)
renewSubscription(id)
deleteSubscription(id)

fetchMessage(mailboxId, messageId)
fetchAttachments(mailboxId, messageId)

deltaMessages(mailboxId, deltaToken)

createDraft(mailboxId, draftPayload)

sendApprovedMessage(mailboxId, messageId / payload)

healthCheck(tenantId)

## Reader requirements
- allowed mailbox list
- Mail.Read application permission only where needed
- Exchange application RBAC restriction
- no send capability

## Writer
Only if categorisation/draft/move requires it:
Mail.ReadWrite

## Sender
Mail.Send
restricted to approved mailboxes.

## Subscription state
Store:
- Graph subscription ID
- tenant
- mailbox
- expiration
- client-state secret reference
- lifecycle status
- delta checkpoint

## Reliability
Notification is not canonical data.
Fetch actual message.

Reconcile with delta.

## Security
- tenant ID validated
- OAuth token audience/issuer
- secret/cert rotation
- never expose Graph token to browser
- audit every outbound action
