# V90 Test Results — Microsoft Graph subscription lifecycle and durable registry

Date: 2026-10-09
Version: 0.10.45

## Result

- Platform test suite: **1,533 / 1,533 passed**
- Production-shape suite: **81 / 81 passed**
- Focused V90 Graph subscription lifecycle suite: **12 / 12 passed**
- Security policy: **26 / 26 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V90 properties exercised

- clientState is generated server-side and absent from public snapshots/events;
- managed secret references are hash-verified before webhook resolution;
- duplicate live resource subscriptions are refused;
- removed subscriptions can be replaced only with an exact resource/tenant predecessor;
- missed lifecycle notifications fail webhook resolution closed until explicit recovery evidence;
- reauthorizationRequired can be resolved by reauthorization or renewal;
- renew/reauthorize collisions are rejected within the configured quiet period;
- expired subscriptions fail closed and disappear from renewal scans;
- remote subscription identity/expiry is validated before local publication;
- create failures clean uncommitted managed secret state;
- production registry state is tenant-bound, forced-RLS, identity-protected and generation-monotonic;
- lifecycle evidence is append-only and excludes raw resource/clientState content.

The in-memory lifecycle authority, Graph client and secret-provider adapters are reference/test boundaries only. V90 does not claim a live Graph subscription API, automatic renewal scheduler, managed secret provider or completed delta recovery implementation.
