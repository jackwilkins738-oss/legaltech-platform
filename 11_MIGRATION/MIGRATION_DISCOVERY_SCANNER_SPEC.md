# PROCLAIM MIGRATION DISCOVERY SCANNER — SPEC

## Goal
Turn migration discovery from consulting exercise into repeatable software.

## Inputs
Authorised read-only export/API/database-derived metadata where contractually permitted.

## Discovery outputs

### Cases/matters
- count
- type
- status
- custom fields
- stage
- owner

### Contacts/parties
- count
- duplicates
- relationships

### Documents/history
- document count
- size
- type
- missing binaries
- naming
- duplicates
- age

### Users
- active
- inactive
- team
- permissions

### Workflows
- definitions
- versions
- triggers
- task types
- dependencies

### Financial
Initially discovery only; specialist mapping later.

### Integrations
- external systems
- credentials/config references
- dependencies

## Output
Migration Readiness Report:
- record counts
- storage
- customisation
- data quality
- unsupported objects
- complexity score
- estimated migration waves
- manual decisions required

## Integrity
Before migration:
- source manifest
- counts
- hashes where possible

After:
- target counts
- reconciliation
- exceptions

## Safety
Read-only by default.
Never modify production Proclaim during discovery.
