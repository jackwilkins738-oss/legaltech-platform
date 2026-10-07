# DATA QUALITY & SCHEMA EVOLUTION

## Problem
Legal operations automation depends on messy customer data.

## Quality dimensions
- completeness;
- validity;
- consistency;
- uniqueness;
- timeliness;
- provenance.

## Canonical-vs-source rule
Never pretend Proclaim source data is clean.
Store:
- canonical value;
- source value;
- source system/id;
- timestamp;
- confidence;
- correction history.

## Master/reference data
Tenant-controlled:
- matter types;
- stages;
- document classes;
- task classes;
- teams;
- offices;
- providers;
- insurers.

Map source labels to canonical concepts.

## Schema evolution
Use:
- additive migrations first;
- explicit versioning;
- backfill jobs;
- validation;
- rollback/dual-read where necessary.

Never change meaning of a field silently.

## Data-quality exceptions
Examples:
- duplicate client;
- impossible DOB/date;
- closed matter receiving active tasks;
- handler missing;
- conflicting claim ref;
- document without matter.

These belong in operational exception handling.

## Correction learning
Human correction may improve:
- mappings;
- classifiers;
- extraction rules.

Do not automatically train global models on confidential corrections without contractual/governance decision.
