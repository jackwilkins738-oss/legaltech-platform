# RELEASE, HOTFIX & ROLLBACK

## Release package
Each production release records:
- artifact version/commit;
- migrations;
- feature/config changes;
- evaluation versions;
- known risks;
- approver;
- rollback/forward-fix.

## Progressive release
Early customers:
1. internal/test;
2. staging;
3. designated pilot tenant;
4. wider rollout.

## Hotfix
Do not bypass audit because urgent.
Record incident/task and follow with regression test.

## Kill switches
Required for:
- autonomous workflow actions;
- outbound messaging;
- AI provider/tool;
- connector write-back.

## External actions
Rollback may be impossible.
Design compensating actions and explicit reconciliation.
