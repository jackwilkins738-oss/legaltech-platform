# ELECTRONIC SIGNATURE / DOCUMENT EXECUTION

## UK baseline
UK eIDAS-derived rules provide that an electronic signature cannot be denied legal effect/admissibility solely because it is electronic; qualified electronic signatures have handwritten-signature equivalence.

Source:
https://www.legislation.gov.uk/eur/2014/910/2026-02-05

## Product strategy
Do not build signature cryptography/provider network initially.

Integrate:
- DocuSign;
- Adobe Sign;
- other enterprise provider demanded by customer.

## What we own
- document version;
- signer/party mapping;
- send approval;
- envelope/status;
- completed document ingest;
- audit trail;
- workflow continuation.

## Execution risks
Some instruments have specific formalities/witnessing requirements.
The product should not infer that every electronic signature method is legally sufficient for every document.

## Requirement
Signature workflow metadata:
- document type;
- required signers;
- witnessing requirement;
- provider;
- completion evidence;
- final hash.

## Build/partner
PARTNER.
