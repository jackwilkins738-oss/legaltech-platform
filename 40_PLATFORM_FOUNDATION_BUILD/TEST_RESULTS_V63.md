# V63 test results

Validated on the reconstructed V62 / 0.10.17 baseline after applying V63 recovery-resilience changes:

- platform suite: 1187/1187 passing;
- focused V63 recovery suite: 9/9 passing;
- production-shape contracts: 36/36 passing;
- security policy: 11/11 passing;
- security regression scan: clean;
- knowledge lint: 0 errors / 0 warnings;
- demo: writeback RECONCILED with positive verification.

V63 does not prove a live cloud backup provider, real PITR retention, immutable/offline copies, a production restore, achieved RTO/RPO, or a ransomware recovery drill. Those remain external deployment and evidence requirements.
