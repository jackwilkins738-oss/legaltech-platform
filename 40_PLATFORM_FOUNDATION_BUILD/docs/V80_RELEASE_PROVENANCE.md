# V80 — Release and configuration provenance

V80 gives each deployable runtime an explicit, secret-free identity spanning source revision, application version, built artifact, migration manifest and security-relevant configuration.

## Safe configuration fingerprint

`fingerprintSafeConfig` hashes only an explicit allowlist of security/operational settings such as OIDC trust, public origin, session lifetimes, managed-store modes, monitoring, backup, readiness, migration, read-volume and lifecycle controls. Credentials, database connection strings and arbitrary environment variables are not part of the snapshot. Only the SHA-256 fingerprint is returned. A configured fingerprint can be timing-safely compared against the computed value. This is the **safe config fingerprint** boundary.

## Release binding

A release descriptor binds `releaseId`, semantic version, 40-hex source revision, artifact SHA-256, migration-manifest SHA-256 and configuration fingerprint. Its canonical release fingerprint changes if any component changes. This is the **release provenance binding** boundary.

A V76-compatible readiness probe reports only `RELEASE_CURRENT`, `RELEASE_DRIFT` or `RELEASE_PROVENANCE_INVALID`; raw environment/configuration is never returned. This is the **release drift readiness** boundary.

## Fleet drift

A bounded fleet assessment accepts only instance IDs plus release/config fingerprints and reports `CONSISTENT`, `MIXED_RELEASE` or `CONFIG_DRIFT`, without exposing environment values or instance-specific secrets. This is the **fleet config drift** boundary.

## Production gates

Production requires verified provenance mode, safe-allowlist fingerprinting and syntactically bounded release/source/artifact/migration/config identities. Real-client-data mode additionally requires externally reviewed release-provenance and configuration-drift-monitoring evidence.

V80 does not claim a signed SBOM, attestation service, live deployment controller or production fleet. Those remain external infrastructure/evidence.
