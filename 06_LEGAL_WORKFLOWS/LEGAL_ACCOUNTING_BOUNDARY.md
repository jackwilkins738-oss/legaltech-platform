# LEGAL ACCOUNTING BOUNDARY

## Decision
Do not build full legal accounting in V1.

## Why
SRA Accounts Rules apply where regulated firms receive or deal with client money.
They require systems and controls appropriate to transaction volume and money handled.

This creates a separate high-risk product domain:
- client money
- office money
- ledgers
- reconciliation
- payment authorisation
- segregation of duties
- audit trails
- residual balances
- transfer controls
- breach consequences

## V1
We may:
- display read-only financial/matter status
- integrate with accounting system
- import approved balance/status information
- support billing workflow without being the ledger of record

We should NOT initially:
- hold client money
- initiate client account transfers
- become the legal accounting ledger
- automate high-risk payment release

## Long-term options
A. never own accounting; integrate deeply
B. acquire/partner
C. build separate regulated-grade accounting module later

## Trigger to revisit
Only after:
- core PMS adopted
- accounting-specific expertise hired
- customer demand proven
- SRA Accounts Rules mapped into product
- independent specialist review

## Sources
SRA Accounts Rules
https://www.sra.org.uk/solicitors/standards-regulations/accounts-rules/

Actionstep accounting integration example
https://support.actionstep.com/hc/en-us/articles/50482570567187-Actionstep-Legal-Accounting-Integration-FAQ
