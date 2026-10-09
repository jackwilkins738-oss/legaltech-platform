# V87 Test Results — Managed encryption key lifecycle metadata

Date: 2026-10-09
Version: 0.10.42

## Result

- Platform test suite: **1,498 / 1,498 passed**
- Production-shape suite: **75 / 75 passed**
- Focused V87 key-lifecycle suite: **8 / 8 passed**
- Security policy: **23 / 23 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V87 properties exercised

- encryption-key records contain metadata only and never raw/wrapped key material;
- tenant and cryptographic purpose are explicit parts of every generation identity;
- generation numbering is monotonic and skipped/reused generations are rejected;
- rotation changes the previous ACTIVE generation to DECRYPT_ONLY before the new generation becomes ACTIVE;
- at most one ACTIVE generation is allowed for each tenant/purpose;
- historical ciphertext remains bound to the exact key alias/generation/provider fingerprint used for encryption;
- RETIRED generations cannot be used for encryption or decryption;
- retirement is allowed only from DECRYPT_ONLY and requires external retirement evidence;
- provider-key fingerprints cannot be reused to disguise a generation rollback;
- production configuration requires managed KMS/HSM-style envelope encryption and durable generation metadata;
- release provenance includes the security-relevant key-lifecycle configuration without including secrets.

The in-memory registry is reference/test infrastructure only. V87 does not implement cryptography, store key bytes, or claim that a live KMS/HSM has been provisioned.
