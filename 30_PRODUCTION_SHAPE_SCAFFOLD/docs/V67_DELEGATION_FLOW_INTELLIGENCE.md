# V67 production-shape delegation and flow intelligence

Migration `012_work_flow_intelligence.sql` adds tenant-scoped generic work delegations, append-only delegation events and append-only aggregate flow snapshots.

Delegations are bounded to 90 days, use the same user/role/team/pool ownership model as V64 and can only transition from ACTIVE to REVOKED without changing their routing identity/window. RLS is forced on every new table. Flow snapshots are tenant aggregate evidence; they are not matter-content records.
