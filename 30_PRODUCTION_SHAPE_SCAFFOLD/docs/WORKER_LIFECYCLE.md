# Worker Lifecycle

State machine:
`PENDING -> RUNNING -> SUCCEEDED`

Failure path:
`RUNNING -> RETRY_WAIT -> PENDING`

Terminal:
`RUNNING/RETRY_WAIT -> DEAD_LETTER`

## Invariants
- one tenant per job;
- stable idempotency key for material external action;
- lease/lock has expiry;
- retry uses exponential backoff + jitter in production;
- timeout after external write is reconciled before retry;
- dead-letter queue is visible/operable;
- job payload references confidential content rather than duplicating it where practical.
