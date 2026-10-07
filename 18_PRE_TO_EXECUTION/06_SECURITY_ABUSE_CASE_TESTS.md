# SECURITY ABUSE-CASE TEST PACK

## Authentication / authorization
S-01 guess another tenant's matter ID
S-02 change document ID in URL/API
S-03 search restricted matter
S-04 retrieve restricted matter through AI
S-05 expired/deprovisioned user session
S-06 ordinary user calls admin endpoint

## Storage
S-10 reuse signed URL after expiry
S-11 modify object key
S-12 access object directly without application authorization

## Graph
S-20 spoof webhook
S-21 wrong clientState
S-22 replay notification
S-23 attempt out-of-scope mailbox
S-24 stolen integration credential exercise

## Workflow
S-30 workflow attempts unsupported external HTTP
S-31 workflow attempts privileged action
S-32 duplicate workflow trigger
S-33 action retry after unknown outcome
S-34 publish workflow without required approval

## AI
S-40 document prompt injection
S-41 request another firm's data
S-42 fabricated citation
S-43 AI attempts unapproved send
S-44 RAG cache reused across users/permissions

## Support/admin
S-50 support user tries customer content without grant
S-51 expired support grant
S-52 break-glass without reason/step-up
S-53 bulk export anomaly

## Acceptance
Every case has:
- expected block/allow result;
- expected audit event;
- alert expectation;
- remediation owner.

Critical cross-tenant test failure blocks all pilot use.
