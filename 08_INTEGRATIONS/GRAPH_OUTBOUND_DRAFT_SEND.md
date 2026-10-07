# MICROSOFT GRAPH — OUTBOUND / DRAFT / SEND ARCHITECTURE

## Principle
Drafting and sending are two different privileges.

## Draft creation
Microsoft Graph supports creating draft messages with:
- delegated Mail.ReadWrite
- application Mail.ReadWrite

Drafts can include attachments and can subsequently be sent.

## Sending
Microsoft Graph sendMail uses Mail.Send.
Application Mail.Send can send as users without a signed-in user.

Microsoft states that Mail.Send does not require Mail.ReadWrite merely to send.

## Recommended trust separation

### Identity A — Reader
Permission:
Mail.Read

Purpose:
- receive/process incoming mail

Cannot:
- modify mailbox
- send

### Identity B — Draft/Write
Permission:
Mail.ReadWrite

Purpose:
- create/update draft
- categorise/move/file mail if product requires it

Cannot automatically send unless also granted send authority.

### Identity C — Sender
Permission:
Mail.Send

Purpose:
- approved outbound actions only

Controls:
- limited mailbox scope
- explicit workflow policy
- audit
- human approval policy
- rate limits
- emergency revoke

## Recommended V1 outbound model
AI/system creates proposed content inside our product.

Then either:
A. human approves → create Outlook draft
or
B. human approves → system sends using Mail.Send

Preferred initial model:
create draft, user reviews/sends.

This reduces:
- accidental external disclosure
- hallucination risk
- wrong-recipient risk
- tone/legal commitment risk

## Later low-risk autonomous sending
Potentially allow only for pre-approved classes such as:
- receipt acknowledgement
- standard document request
- reminder/chase
- appointment confirmations

Requirements:
- exact template/policy
- known recipient
- matter permission
- no material legal advice
- suppression rules
- human-configurable thresholds
- immutable audit

## Recipient safety
Before send:
- confirm tenant
- confirm matter
- verify intended recipient against matter contact
- detect external/unknown domain
- detect unusual recipient count
- block cross-client recipient mix
- prevent autocomplete-style leakage
- warn/require step-up for highly sensitive attachments

## Mailbox scoping
Use Exchange Online application RBAC / supported access restriction mechanisms so application permissions do not automatically mean every mailbox in the tenant.

## Sources
Microsoft Graph create message:
https://learn.microsoft.com/en-us/graph/api/user-post-messages

Microsoft Graph permissions:
https://learn.microsoft.com/en-us/graph/permissions-reference

Exchange Online Application RBAC:
https://learn.microsoft.com/en-gb/exchange/permissions-exo/application-rbac
