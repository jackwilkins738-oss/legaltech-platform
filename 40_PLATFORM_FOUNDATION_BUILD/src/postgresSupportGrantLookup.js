// V149 database lookup adapter for V146 reader.
// transact MUST supply a tenant-scoped read-only PostgreSQL transaction using
// an RLS-restricted account. This module does not create database credentials.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES=new Set(['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']);
const denied=()=>new Error('DURABLE_SUPPORT_GRANT_UNAVAILABLE');
export const SUPPORT_GRANT_LOOKUP_SQL=`
SELECT r.id, r.tenant_id, r.requester_id, r.matter_id, r.scope,
       r.document_ref_hash
FROM support_access_requests AS r
JOIN support_access_approvals AS a
  ON a.tenant_id=r.tenant_id AND a.request_id=r.id
WHERE r.tenant_id=$1::uuid AND r.requester_id=$2::uuid
  AND r.id=$3::uuid AND r.matter_id=$4::uuid AND r.scope=$5
  AND r.document_ref_hash IS NOT DISTINCT FROM $6::char(64)
  AND r.created_at <= statement_timestamp()
  AND r.expires_at > statement_timestamp()
  AND a.approved_at <= statement_timestamp()
  AND NOT EXISTS (
    SELECT 1 FROM support_access_revocations AS v
    WHERE v.tenant_id=r.tenant_id AND v.request_id=r.id
  )
LIMIT 2`;
export function createPostgresSupportGrantLookup({transact}={}){
  if(typeof transact!=='function')throw new Error('DURABLE_SUPPORT_GRANT_CONFIGURATION_INVALID');
  return async function readCurrent(input){
    try{
      if(!input||Object.getPrototypeOf(input)!==Object.prototype||
        !['tenantId','actorId','requestId','matterId'].every(k=>typeof input[k]==='string'&&UUID.test(input[k]))||
        !SCOPES.has(input.scope)||input.signal?.aborted||
        (input.scope==='DOCUMENT_READ'?!/^[a-f0-9]{64}$/.test(input.documentRefHash??''):input.documentRefHash!==null))throw denied();
      const args=[input.tenantId,input.actorId,input.requestId,input.matterId,input.scope,input.documentRefHash];
      const result=await transact(Object.freeze({tenantId:input.tenantId,readOnly:true,signal:input.signal}),async tx=>{
        const rows=await tx.query(SUPPORT_GRANT_LOOKUP_SQL,args);
        if(rows.rows?.length!==1)throw denied();
        const r=rows.rows[0];
        if(r.id!==input.requestId||r.tenant_id!==input.tenantId||r.requester_id!==input.actorId||
          r.matter_id!==input.matterId||r.scope!==input.scope||
          (r.document_ref_hash===null?null:String(r.document_ref_hash).trim())!==input.documentRefHash)throw denied();
        return Object.freeze({...input,signal:undefined,active:true});
      });
      if(input.signal?.aborted||result?.active!==true)throw denied();
      const {signal,...decision}=result;
      return Object.freeze(decision);
    }catch{throw denied();}
  };
}
