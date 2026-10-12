// Guard for the dormant PostgreSQL messaging schema.
// This does not grant permissions or enable a production endpoint.
export function assertConversationStorageDormant(rows) {
  const names=new Set([
    'matter_conversation_threads',
    'matter_conversation_participants',
    'matter_conversation_messages',
    'matter_conversation_audit'
  ]);
  if(!Array.isArray(rows)||rows.length!==names.size)throw new Error('CONVERSATION_ADMISSION_DENIED');
  for(const row of rows){
    if(!row||!names.delete(row.relname)||
       row.relrowsecurity!==true||row.relforcerowsecurity!==true||
       row.has_runtime_dml!==false||row.has_restrictive_deny!==true)
      throw new Error('CONVERSATION_ADMISSION_DENIED');
  }
  if(names.size)throw new Error('CONVERSATION_ADMISSION_DENIED');
  return Object.freeze({status:'DORMANT',tables:4});
}

export const conversationStorageProofSql=`
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
  pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS has_runtime_dml,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid=c.oid AND p.polpermissive=false AND p.polcmd='*'
      AND pg_catalog.pg_get_expr(p.polqual,p.polrelid)='false'
      AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)='false'
  ) AS has_restrictive_deny
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname=ANY($1::text[])
`;
