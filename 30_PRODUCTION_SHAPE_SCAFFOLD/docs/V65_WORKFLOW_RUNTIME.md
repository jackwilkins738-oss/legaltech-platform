# V65 production workflow-runtime contract

`010_workflow_runtime.sql` adds versioned workflow definitions, pinned workflow instances, append-only workflow events, tenant feature flags and notification intents. All tables are tenant-bound and forced through RLS. Matter-bound instances inherit matter access. Published workflow definitions are protected against definition mutation at the database boundary.

Notification rows are intents only. V65 does not create a Teams/Graph delivery credential or external-send permission.
