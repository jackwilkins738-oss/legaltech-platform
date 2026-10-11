import {pinSupportFields} from './supportAuthorityInput.js';
import {SUPPORT_GRANT_LOOKUP_SQL} from './postgresSupportGrantLookup.js';
import {PostgresTenantTransactions} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';

// The revoker must acquire the identical transaction advisory lock before
// writing a revocation. Lock ownership serializes successful byte delivery
// with the commit of revocation across separate PostgreSQL connections.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const deny=()=>new Error('SUPPORT_TRANSFER_FENCE_UNAVAILABLE');
const validId=value=>typeof value==='string'&&UUID.test(value);

export function createPostgresSupportTransferFence({transact}={}){
  if(typeof transact!=='function')throw new Error('SUPPORT_TRANSFER_FENCE_CONFIGURATION_INVALID');
  return async function guardedTransfer(input,consume){
    let pinned;
    try {
      pinned=pinSupportFields(input,['tenantId','actorId','requestId','matterId','scope','documentRefHash'],['signal'],deny);
      if(!validId(pinned.tenantId)||!validId(pinned.actorId)||!validId(pinned.requestId)||
        !validId(pinned.matterId)||pinned.scope!=='DOCUMENT_READ'||typeof pinned.documentRefHash!=='string'||
        !HASH.test(pinned.documentRefHash)||typeof consume!=='function'||pinned.signal?.aborted)throw deny();
      return await transact(Object.freeze({tenantId:pinned.tenantId,actorId:pinned.actorId,readOnly:true,signal:pinned.signal}),async tx=>{
        // Same advisory key format and hash function as approval/revocation.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [JSON.stringify([pinned.tenantId,pinned.requestId])]);
        if(pinned.signal?.aborted)throw deny();
        const query=await tx.query(SUPPORT_GRANT_LOOKUP_SQL,
          [pinned.tenantId,pinned.actorId,pinned.requestId,pinned.matterId,pinned.scope,pinned.documentRefHash]);
        const row=query.rows?.[0];
        if(query.rows?.length!==1||row.id!==pinned.requestId||row.tenant_id!==pinned.tenantId||
          row.requester_id!==pinned.actorId||row.matter_id!==pinned.matterId||
          row.scope!==pinned.scope||String(row.document_ref_hash??'').trim()!==pinned.documentRefHash)throw deny();
        if(pinned.signal?.aborted)throw deny();
        // A transaction fence protects the grant, not arbitrary external
        // document bytes: require the caller's trusted delivery validator to
        // execute *inside* the held transaction before transfer.
        const result=await consume(Object.freeze({...pinned,signal:pinned.signal}));
        if(pinned.signal?.aborted)throw deny();
        return result;
      });
    }catch{throw deny();}
  };
}

export function createTenantScopedPostgresSupportTransferFence({pool,expectedRole,timeoutMs=5000}={}){
  if(typeof expectedRole!=='string'||!/^legaltech_support_reader_[a-z0-9_]{1,30}$/.test(expectedRole))
    throw new Error('SUPPORT_TRANSFER_FENCE_CONFIGURATION_INVALID');
  const transactions=new PostgresTenantTransactions({pool,expectedRole,timeoutMs});
  return createPostgresSupportTransferFence({transact:(scope,work)=>
    transactions.run(scope,async tx=>{
      const proof=await tx.query(`SELECT
        pg_has_role(current_user,'legaltech_support_reader','MEMBER') AS member,
        row_security_active('public.support_access_requests'::regclass) AS requests_rls,
        row_security_active('public.support_access_approvals'::regclass) AS approvals_rls,
        row_security_active('public.support_access_revocations'::regclass) AS revocations_rls,
        has_table_privilege(current_user,'public.support_access_events','SELECT') AS audit_read,
        has_table_privilege(current_user,'public.support_access_requests','INSERT,UPDATE,DELETE,TRUNCATE') AS request_write,
        has_table_privilege(current_user,'public.support_access_approvals','INSERT,UPDATE,DELETE,TRUNCATE') AS approval_write,
        has_table_privilege(current_user,'public.support_access_revocations','INSERT,UPDATE,DELETE,TRUNCATE') AS revocation_write`);
      const row=proof.rows?.[0];
      if(proof.rows?.length!==1||row.member!==true||row.requests_rls!==true||row.approvals_rls!==true||
        row.revocations_rls!==true||row.audit_read!==false||row.request_write!==false||
        row.approval_write!==false||row.revocation_write!==false)throw deny();
      return work(tx);
    })
  });
}
