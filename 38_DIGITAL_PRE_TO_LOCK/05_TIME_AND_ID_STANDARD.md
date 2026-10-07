# Time and identifier standard

STATUS: CURRENT
AUTHORITY: HIGH

## Observation time
- Capture source-local date/time plus session identifier.
- Prefer second-level precision for short tasks.
- Record timezone/offset once per session/export.
- Preserve original source timestamps in raw data.
- Normalise to ISO-8601/UTC only in cleaned/derived datasets when joining systems.

## Identifiers
- `SESSION-###` for observation sessions.
- `EVT-####` for observed events.
- `MAT-###` or salted/hash identifiers for matters.
- Never use a client's name as an identifier.

## Cross-system joins
Do not assume clocks are perfectly synchronised. Record known clock/source differences before matching events across Proclaim, M365 and manual observations.
