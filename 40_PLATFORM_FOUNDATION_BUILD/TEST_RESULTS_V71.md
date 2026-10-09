# V71 Validation Results

Version: `0.10.26`

- Platform suite: **1324/1324 passed**
- Focused V71 organisation-directory suite: **17/17 passed**
- Production-shape suite: **42/42 passed**
- Security policy suite: **11/11 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration
- Demo: **RECONCILED / verified true**

## Proven V71 boundary

- TEAM/POOL group identity is tenant-bound and immutable through its lifecycle.
- Actor membership is server-side, time-aware and overlap protected.
- Future, expired, revoked and retired membership does not grant group-derived work authority.
- Directory failure fails closed rather than broadening access.
- V69 consumes the directory only through an explicit trusted resolver; behavior without one remains deny-by-default for TEAM/POOL self authority.
- Group and membership lifecycle evidence is append-only.
- Production-shape membership rows use tenant-composite references to groups and actors.

## Deliberately not claimed

V71 does not define real firm team names, reporting lines, supervisor powers, Co-op role mappings, workload balancing or routing. Those require trusted organisation data and TO evidence.
