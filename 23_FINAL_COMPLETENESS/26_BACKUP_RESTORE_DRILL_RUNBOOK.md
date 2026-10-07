# BACKUP / RESTORE DRILL

## Quarterly minimum
Select synthetic/staging dataset.

Test:
1. locate recovery point;
2. restore database to isolated environment;
3. restore/verify object documents;
4. verify encryption/key access;
5. reconcile DB/object references;
6. validate audit;
7. validate deleted-data behaviour;
8. measure RTO/RPO.

## Failure
A backup is not proven because a job says "successful."

Only a successful restore demonstrates recoverability.

## Evidence
- restore point;
- start/end;
- dataset;
- checks;
- errors;
- achieved RTO/RPO;
- remediation.

## Production disaster
Restore into clean environment; do not overwrite forensic evidence blindly.
