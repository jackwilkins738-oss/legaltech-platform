# PENETRATION TEST SCOPE

## Before first enterprise production
Use an independent qualified tester when product surface is stable enough to test.

## Scope
- web app/API;
- tenant isolation;
- auth/SSO;
- information barriers;
- object storage;
- upload/parser;
- Graph integration;
- Proclaim connector boundary;
- workflow engine;
- admin/support;
- RAG/search;
- AI tool authorization.

## Priority scenarios
- BOLA/IDOR;
- cross-tenant;
- privilege escalation;
- support impersonation;
- signed URL abuse;
- SSRF;
- injection;
- webhook spoof/replay;
- workflow privilege;
- prompt injection into tools;
- secrets exposure.

## Report management
Track:
- severity;
- evidence;
- owner;
- target date;
- fix;
- retest.

## Release rule
Critical/high issues affecting isolation, auth, confidential data or privileged actions block production until resolved/accepted by authorised security owner with documented rationale.

## Customer evidence
Share executive summary/letter under NDA where appropriate, not raw exploit detail by default.
