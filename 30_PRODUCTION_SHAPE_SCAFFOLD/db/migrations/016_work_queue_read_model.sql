BEGIN;

-- V74: query-supporting indexes for bounded work queues. No new workflow semantics.
CREATE INDEX IF NOT EXISTS idx_work_queue_user
  ON work_items(tenant_id,owner_kind,owner_actor_id,state,priority DESC,due_at,created_at,id)
  WHERE owner_kind='USER';
CREATE INDEX IF NOT EXISTS idx_work_queue_group
  ON work_items(tenant_id,owner_kind,owner_ref,state,priority DESC,due_at,created_at,id)
  WHERE owner_kind IN ('ROLE','TEAM','POOL');
CREATE INDEX IF NOT EXISTS idx_work_queue_type_state
  ON work_items(tenant_id,state,work_type,priority DESC,due_at,created_at,id);
CREATE INDEX IF NOT EXISTS idx_work_queue_matter_order
  ON work_items(tenant_id,matter_id,state,priority DESC,due_at,created_at,id)
  WHERE matter_id IS NOT NULL;

COMMIT;
