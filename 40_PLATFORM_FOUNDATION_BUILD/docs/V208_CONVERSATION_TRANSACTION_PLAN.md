# V208 PostgreSQL conversation transaction plan

Production use remains prohibited. The current schema has forced restrictive-deny row-level policies, no application grants, and immutable evidence constraints.

## Read-only admission probe

Before adding a mutation pathway, a production operator must be able to prove at runtime that every conversation table remains protected by FORCE RLS and restrictive policies, and that the intended runtime has no direct DML privileges. Probe execution must use a verified, actor-bound transaction rather than trusting ambient connection state.

## Mutation acceptance requirements

Creation, message posting, participant changes and audit inserts must execute atomically inside a tenant-bound transaction. Validate every principal against the tenant, live session, matter access and recipient directory. A revocation must serialize with concurrent writes across independent servers. Client retry identifiers must have durable uniqueness and payload-bound replay semantics.

## No activation

Do not introduce client data or enable messaging routes in production. D-018 and existing governance gates remain in force.
