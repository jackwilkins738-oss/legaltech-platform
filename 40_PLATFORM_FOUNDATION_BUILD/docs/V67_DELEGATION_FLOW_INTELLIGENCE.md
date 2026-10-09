# V67 — Delegation and Flow Intelligence

V67 adds generic absence/delegation primitives and aggregate operational flow intelligence without deciding the firm's escalation ladder before TO evidence exists.

## Delegation

- generic `USER`, `ROLE`, `TEAM` and `POOL` principals/delegates;
- explicit start/end windows capped at 90 days;
- self-delegation rejection;
- overlapping active rules for the same principal fail closed;
- chain resolution with cycle/depth protection;
- optimistic revocation;
- append-only grant/revoke events and audit evidence;
- no silent reassignment of existing work.

The directory is intentionally a routing primitive. A workflow or authorised operator must choose when to apply the resolved owner; V67 does not invent Co-op holiday, cover or management rules.

## Flow intelligence

The snapshot engine derives aggregate operational state from V64 work/dependencies:

- open work and state counts;
- overdue work;
- current internal, external and blocked waiting time;
- active dependencies;
- completed work within a caller-specified window;
- structured-request response latency;
- queue volume/age by generic owner;
- downstream work/matter counts blocked by each owner;
- blocker request types and oldest downstream wait.

This supports a future `Blocked by me` or team-flow view without storing message content in telemetry. Persisted snapshots contain aggregates, not work titles or matter identifiers, and are append-only so trends can be compared later.

## Deliberately deferred

V67 sets no SLA, no automatic escalation timer, no Legal Admin -> Case Manager -> Team Leader ladder and no load-balancing policy. TO evidence should determine those rules.
