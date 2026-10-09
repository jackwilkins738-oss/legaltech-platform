# V87 — Managed encryption key lifecycle metadata

V87 introduces workflow-agnostic metadata for managed envelope-encryption key generations without implementing cryptography or persisting key material in the application.

## Model

Each tenant/purpose has a monotonic generation sequence. Exactly one generation is ACTIVE for encryption; rotation moves the prior generation to DECRYPT_ONLY so historical ciphertext remains readable. A DECRYPT_ONLY generation can become RETIRED only with externally reviewed retirement/destruction evidence. RETIRED generations cannot authorize decryption.

Ciphertext metadata can be pinned to tenant, purpose, alias, generation and provider-key fingerprint. A generation rollback, skipped generation, provider-fingerprint reuse, cross-tenant/purpose substitution or retired generation fails closed.

The reference registry requires a trusted `authorizeChange` boundary for registration, rotation and retirement. It stores no key bytes.

## Production shape

Migration `024_key_lifecycle.sql` stores only key lifecycle metadata and provider-key fingerprints. It enforces one ACTIVE generation per tenant/purpose, immutable generation identity, constrained lifecycle transitions, forced RLS and append-only key events.

Production requires:

- `DATA_ENCRYPTION_MODE=envelope-managed`
- `DATA_KEY_PROVIDER_MODE=managed-kms`
- `KEY_GENERATION_METADATA_MODE=durable`
- `KEY_ROTATION_MODE=generation-pinned`

Real-client-data readiness additionally requires `ENCRYPTION_KEY_LIFECYCLE_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

V87 does not implement encryption primitives, hold cryptographic key material, select a KMS/HSM vendor, or claim live key rotation. The production deployment must use a reviewed managed KMS/HSM and external change-control evidence.
