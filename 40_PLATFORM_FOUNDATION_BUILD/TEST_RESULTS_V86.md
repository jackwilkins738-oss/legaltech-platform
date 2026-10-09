# V86 Test Results — Secure document delivery

Date: 2026-10-09
Version: 0.10.41

## Result

- Platform test suite: **1,490 / 1,490 passed**
- Production-shape suite: **73 / 73 passed**
- Focused V86 document-delivery suite: **12 / 12 passed**
- Security policy: **22 / 22 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V86 properties exercised

- grant issue requires current matter/document authorization;
- grants are tenant/actor bound, short-lived and single-use;
- document authorization is re-evaluated on redemption;
- restricted matters and security-zone documents cannot be bypassed;
- document identity and storage integrity are rechecked before bytes are returned;
- browser input cannot supply object-storage references or public destinations;
- grant/event evidence contains no bearer token or raw object reference;
- V82 `ALL_EGRESS` interlock blocks document delivery;
- production evidence is tenant/matter/actor bound with unique consumption;
- production configuration disables public-link delivery.

The in-memory grant registry is reference/test infrastructure only; no live distributed grant store or CDN is claimed.
