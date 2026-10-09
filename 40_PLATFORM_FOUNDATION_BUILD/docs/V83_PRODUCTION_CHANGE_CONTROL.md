# V83 — Production change governance

V83 adds a generic approval boundary for normal production behavior changes without defining any legal workflow.

## Controlled changes

The reference registry supports exact approval evidence for:

- workflow publication;
- response/escalation policy publication;
- feature-flag changes; and
- retention-policy publication.

A request is tenant-bound to a change type, target reference and SHA-256 target hash. Requests expire within seven days, approval must come from a different authorized actor, and approved evidence can be consumed once only against the exact bound target. Failed downstream execution does not silently burn otherwise valid approval evidence.

## Emergency path

V82 security interlocks are deliberately separate. Emergency egress/write/session containment must remain immediately available and is not delayed by V83's normal change process.

## Production shape

Migration `020_production_change_control.sql` provides tenant-scoped request/event evidence with forced RLS, immutable target identity, dual-control approval, bounded expiry, one-way lifecycle transitions and append-only change events. Production configuration requires dual-control, hash-bound single-use approval before workflow/policy/feature publication.

## Boundary

This is a governance primitive, not evidence that a firm's real approver matrix, production deployment service or change board has been configured. Real-client-data approval still requires reviewed change-control evidence and all earlier external gates.
