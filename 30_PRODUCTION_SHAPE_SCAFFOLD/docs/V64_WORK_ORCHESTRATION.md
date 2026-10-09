# V64 production work-orchestration contract

`009_work_orchestration.sql` adds tenant-bound work items, dependencies and append-only work events. Matter references and user actor references use composite tenant foreign keys. Every table is forced through RLS; matter-bound work inherits the existing effective matter-access boundary.

Work ownership can target a user or an opaque role/team/pool reference. The production database does not encode firm-specific role names or routing rules before TO evidence exists.
