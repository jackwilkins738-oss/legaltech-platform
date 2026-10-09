# V73 — Bounded notification delivery containment

V73 turns V65 notification intents into a bounded delivery boundary without allowing workflow logic to become an arbitrary external messaging channel.

## Boundary

- Delivery is tenant-scoped and claims only `QUEUED` intents for the requested tenant/channel.
- `IN_APP` is a local reference adapter. `TEAMS` has no default external adapter and therefore fails closed until a credentialed transport is explicitly injected.
- External adapters receive a frozen structured envelope containing only tenant/notification identifiers, channel, approved template ID, generic recipient reference, generic object reference, severity and trace ID. Matter text, document bodies and connector credentials are not included. This is the **notification delivery content containment** boundary.
- Adapter results may contain only a bounded provider delivery reference. The reference is SHA-256 hashed before persistence; extra fields or secret-shaped result keys are rejected.
- Raw adapter exception text is never persisted to notification state, delivery evidence or audit evidence.
- Delivery retries are capped at three claims; stale `SENDING` leases recover only while retry budget remains. This is the **notification delivery retry cap**.
- Expired queued intents are marked dead and cannot later be sent.
- Delivery evidence is append-only in both the reference store and production-shaped schema. This is the **notification delivery append-only** boundary.
- Production-shaped delivery evidence uses tenant-composite foreign keys and forced RLS. This is the **notification delivery tenant binding** boundary.
- Adapter calls are time-bounded and receive an abort signal.

## Deliberately not included

No live Microsoft Teams tenant, webhook/bot credential, Graph send permission, user-facing notification template content, firm-specific routing, SLA or automatic polling cadence is configured. Those remain deployment/configuration evidence after TO and live integration validation.
