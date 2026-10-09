# V97 — SBOM and build-provenance attestation boundary

V97 adds a reference CycloneDX 1.7 SBOM builder and an external-signature attestation verifier for release artifact, SBOM, provenance and source-revision hashes. The application does not create or trust its own signing keys: signature trust is injected from managed CI/KMS/attestation infrastructure.

Verified evidence persists only release/digest/reference metadata. Signature envelopes, builder credentials and raw attestations remain external. Readiness can fail closed if the verified artifact/source revision does not match the expected deployment.

The provenance model is intended to align with SLSA v1.2. This version does not claim a SLSA level or signed production build until the external build system provides that evidence.
