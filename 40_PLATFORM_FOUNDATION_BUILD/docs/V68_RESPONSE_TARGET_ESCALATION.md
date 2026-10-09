# V68 — Configurable Response Targets and Escalation Intents

V68 provides the generic machinery for follow-up/escalation after TO without inventing any firm's SLA or reporting line in advance.

## Policy model

Response policies are versioned, content-hashed and explicitly published. A policy can select bounded work types, states and owner kinds, then evaluate one of three clocks:

- work creation time;
- current waiting start time;
- due time.

The threshold is configurable up to 30 days. No policies are installed by default.

## Safe actions

A policy may only:

1. queue an `IN_APP` or `TEAMS` notification intent to the existing work owner; or
2. create an explicit `ESCALATION` work request for a configured generic user/role/team/pool owner.

V68 never silently changes the source work owner. Generated escalation work is marked so escalation evaluation cannot recursively escalate its own generated records. External Teams delivery remains V65's separate notification-delivery boundary.

## Evidence

Each `(policy version, source work)` pair has one deduplicated escalation intent. Intents can be acknowledged with optimistic concurrency, and trigger/acknowledgement events are append-only. Published policy content cannot be edited in place; a changed threshold or selector requires a new version.

## TO boundary

The engine deliberately has no built-in value for "manager should reply in X minutes", no Legal Admin -> Case Manager -> Team Leader ladder and no automatic load balancing. Those values must come from observed workflow, operational risk and pilot evidence.
