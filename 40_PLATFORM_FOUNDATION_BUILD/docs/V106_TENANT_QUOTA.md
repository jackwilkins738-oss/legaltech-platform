# V106 Tenant-scoped admission quotas

V106 adds workflow-agnostic tenant/resource admission budgets with explicit server configuration and no default limits. Reservations prevent concurrent overcommit; commit/release semantics avoid charging failed work; budgets are isolated by tenant and resource. Generic work creation is the first consumer and idempotent replay does not consume a second unit. Production requires shared managed enforcement.
