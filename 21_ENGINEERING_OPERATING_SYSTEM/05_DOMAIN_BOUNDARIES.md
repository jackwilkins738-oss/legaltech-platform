# DOMAIN BOUNDARIES

## Tenancy & Identity
Owns:
- tenants;
- users;
- teams;
- roles;
- security zones;
- external identity mappings.

## Matters
Owns:
- canonical matter identity;
- stage/status;
- responsible users;
- external mappings.

## Communications
Owns:
- inbound/outbound communications metadata;
- message versions;
- sender/recipient metadata;
- communication state.

## Documents
Owns:
- document metadata;
- versions;
- hashes;
- security classification;
- provenance.

## Tasks / Work
Owns:
- task;
- owner;
- due date;
- state;
- source;
- approval state.

## Exceptions
Owns:
- exception type;
- priority;
- reason;
- owner;
- resolution.

## Workflow
Owns:
- definition/version;
- published state;
- run;
- step;
- retry/compensation.

## Integrations
Owns:
- connections;
- credentials references;
- external IDs;
- sync checkpoints;
- connector health.

## AI Orchestration
Owns:
- request/prompt template version;
- provider/model;
- structured result;
- confidence;
- evaluation metadata.

## Audit
Owns immutable event envelope.
Other domains emit; they do not rewrite audit.
