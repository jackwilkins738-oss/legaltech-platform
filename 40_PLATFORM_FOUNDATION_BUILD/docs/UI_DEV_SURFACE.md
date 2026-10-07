# Synthetic Review UI

Lifecycle: current development surface.

The local dev server now serves a browser UI at `http://127.0.0.1:3210`. It is intentionally synthetic and must not be exposed as a production application.

## Current screens
- My Work
- Inbound Queue
- Exception Review
- Matters
- Audit Trail

## Safety boundary
The UI uses the existing static local development bearer token. Production authentication remains unimplemented and must not copy this mechanism. Tenant identity continues to be derived server-side from the authenticated session.

## Demo path
Generate demo item -> inbound worker -> human exception -> select matter -> approve/reject -> mock Proclaim writeback -> reconciliation -> audit.
