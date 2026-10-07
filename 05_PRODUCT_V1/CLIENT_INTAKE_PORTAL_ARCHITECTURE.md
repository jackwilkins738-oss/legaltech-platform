# CLIENT INTAKE / PORTAL ARCHITECTURE

## Scope
Not core V1 wedge, but important adjacent product.

## Goals
Reduce:
- email attachments
- duplicate entry
- missing intake information
- identity-document mishandling
- client status calls

## Intake
Secure link
→ identity/session
→ structured questionnaire
→ document upload
→ validation
→ consent
→ submission
→ matter/prospect creation
→ exception queue

## Security
- short-lived signed invitation
- MFA/verification proportional to sensitivity
- rate limiting
- secure file upload
- malware scan
- encrypted storage
- no client-to-client enumeration
- tenant routing
- access expiry

## Portal features later
- messages
- document requests
- upload
- forms
- appointments
- status milestones
- secure copies of approved documents

## Do not expose internal legal notes by default.

## Status design
Client-facing stages should be understandable:
"Waiting for medical evidence"
rather than internal technical workflow states.

## Accessibility
Portal should meet WCAG target and work on mobile.
