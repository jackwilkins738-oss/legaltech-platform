# V64 — Generic Work Orchestration Foundation

V64 adds workflow-agnostic work primitives before TO evidence is available. It does **not** define a Co-op-specific admin/case-manager process.

The reference layer supports typed work (`TASK`, `QUESTION`, `DECISION`, `REVIEW`, `APPROVAL`, `HANDOFF`, `ESCALATION`), explicit work states, generic `USER`/`ROLE`/`TEAM`/`POOL` ownership, optimistic versioning, idempotent creation, assignment history, matter binding, append-only work events and bounded queues.

Work items can depend on other work items. Active dependencies place the dependent item into `WAITING_INTERNAL`; completion of the blocker resolves dependency evidence and automatically reactivates downstream work only when no active dependencies remain. Cycles, self-dependencies, cross-tenant references, stale writes and completion with unresolved dependencies are rejected.

Structured request work can be answered once with a durable response. Queue metrics expose state counts, overdue work, current internal-wait duration and request response latency without prescribing role-specific dashboards.

TO evidence must decide which request types, queues, escalation rules, response targets and interfaces are actually useful. V64 is only the generic engine required to express those decisions later.
