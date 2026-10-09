# V63 production recovery contract

`008_recovery_resilience.sql` adds tenant-bound append-only recovery evidence with database-generated hash chaining, RLS and mutation denial. Backup bytes are intentionally outside this table and must live in a managed immutable backup plane using credentials unavailable to the normal application runtime.

Production configuration requires immutable managed backup mode, isolated workload identity, separate KMS keys, two-person deletion protection, PITR, durable recovery evidence, isolated ransomware restoration and clean recovery targets. These are fail-closed contracts, not evidence that a provider has been configured.
