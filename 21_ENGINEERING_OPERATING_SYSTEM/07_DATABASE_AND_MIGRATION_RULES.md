# DATABASE & MIGRATION RULES

## Schema changes
Prefer:
1. additive column/table;
2. dual-read/write if needed;
3. backfill;
4. switch;
5. later cleanup.

Avoid destructive one-step migrations.

## Production migration rules
- migration reviewed;
- staging rehearsal;
- backup/restore confidence;
- expected duration;
- lock impact assessed;
- rollback/forward-fix defined.

## Data access
Use repository/domain methods.
No UI/client direct DB access to privileged data.

## RLS
Use as defence in depth, not sole authorization system.
RLS tests must include cross-tenant attempts.

## Backfills
Every backfill:
- resumable;
- idempotent;
- observable;
- rate-limited;
- tenant-scoped;
- dry-run where practical.

## Seed/test data
Synthetic only.
Never commit real legal data.
