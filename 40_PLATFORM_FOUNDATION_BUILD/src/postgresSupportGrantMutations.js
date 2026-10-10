import {PostgresTenantTransactions} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';
import crypto from 'node:crypto';
// V153 reference durable mutation adapter. transact MUST be a trusted,
// tenant-scoped PostgreSQL transaction with operator authorization and RLS.
// All events and state changes commit or roll back together.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SCOPES=new Set(['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']);
const denied=()=>new Error('DURABLE_SUPPORT_MUTATION_UNAVAILABLE');
function uuid(x){return typeof x==='string'&&UUID.test(x);}
function base(s,traceId){if(!s||!uuid(s.tenantId)||!uuid(s.actorId)||!uuid(s.sessionId)||typeof traceId!=='string'||!TRACE.test(traceId))throw denied();}
async function live(boundary,session){if(await boundary.assertCurrent(session)!==true)throw denied();}
export class PostgresSupportGrantMutations {
  #transact;#live;
  constructor({transact,liveSession}={}) {
    if(typeof transact!=='function'||typeof liveSession?.assertCurrent!=='function')throw new Error('DURABLE_SUPPORT_MUTATION_CONFIGURATION_INVALID');
    this.#transact=transact;this.#live=liveSession;
  }
  async request({session,matterId,scope,documentRefHash=null,ticketRefHash,purposeHash,traceId}={}){
    base(session,traceId);
    if(!uuid(matterId)||!SCOPES.has(scope)||!/^([a-f0-9]{64})$/.test(ticketRefHash??'')||
      !/^([a-f0-9]{64})$/.test(purposeHash??'')||
      (scope==='DOCUMENT_READ'?!/^[a-f0-9]{64}$/.test(documentRefHash??''):documentRefHash!==null))throw denied();
    try {
      await live(this.#live,session);
      return await this.#transact({tenantId:session.tenantId,actorId:session.actorId,readOnly:false},async tx=>{
        const requestId=crypto.randomUUID();
        const result=await tx.query(`INSERT INTO public.support_access_requests
          (id,tenant_id,requester_id,matter_id,scope,document_ref_hash,ticket_ref_hash,purpose_hash,trace_id,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,statement_timestamp()+interval '10 minutes')
          RETURNING id,tenant_id,requester_id,matter_id,scope`,
          [requestId,session.tenantId,session.actorId,matterId,scope,documentRefHash,ticketRefHash,purposeHash,traceId]);
        if(result.rows?.length!==1||result.rows[0].id!==requestId)throw denied();
        await tx.query(`INSERT INTO public.support_access_events
          (tenant_id,request_id,actor_id,matter_id,event_type,resource_hash,trace_id)
          VALUES($1,$2,$3,$4,'REQUESTED',$5,$6)`,
          [session.tenantId,requestId,session.actorId,matterId,documentRefHash,traceId]);
        return Object.freeze({requestId,tenantId:session.tenantId});
      });
    }catch{throw denied();}
  }
  async approve({session,requestId,traceId}={}){
    base(session,traceId);if(!uuid(requestId))throw denied();
    try{
      await live(this.#live,session);
      return await this.#transact({tenantId:session.tenantId,actorId:session.actorId,readOnly:false},async tx=>{
        // Serializes approval against revocation across independent workers.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([session.tenantId,requestId])]);
        const r=await tx.query(`SELECT id,matter_id,requester_id,document_ref_hash FROM public.support_access_requests
          WHERE tenant_id=$1 AND id=$2 AND expires_at>statement_timestamp()`,[session.tenantId,requestId]);
        if(r.rows?.length!==1||r.rows[0].requester_id===session.actorId)throw denied();
        const revoked=await tx.query('SELECT 1 FROM public.support_access_revocations WHERE tenant_id=$1 AND request_id=$2',[session.tenantId,requestId]);
        if(revoked.rows?.length)throw denied();
        const added=await tx.query(`INSERT INTO public.support_access_approvals(tenant_id,request_id,approver_id,trace_id)
          VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,request_id) DO NOTHING RETURNING request_id`,
          [session.tenantId,requestId,session.actorId,traceId]);
        if(added.rows?.length!==1)throw denied();
        await tx.query(`INSERT INTO public.support_access_events(tenant_id,request_id,actor_id,matter_id,event_type,resource_hash,trace_id)
          VALUES($1,$2,$3,$4,'APPROVED',$5,$6)`,
          [session.tenantId,requestId,session.actorId,r.rows[0].matter_id,r.rows[0].document_ref_hash,traceId]);
        return Object.freeze({requestId,status:'ACTIVE'});
      });
    }catch{throw denied();}
  }
  async revoke({session,requestId,reasonHash,traceId}={}){
    base(session,traceId);if(!uuid(requestId)||!/^([a-f0-9]{64})$/.test(reasonHash??''))throw denied();
    try{
      await live(this.#live,session);
      return await this.#transact({tenantId:session.tenantId,actorId:session.actorId,readOnly:false},async tx=>{
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([session.tenantId,requestId])]);
        const r=await tx.query('SELECT matter_id,document_ref_hash FROM public.support_access_requests WHERE tenant_id=$1 AND id=$2',[session.tenantId,requestId]);
        if(r.rows?.length!==1)throw denied();
        const added=await tx.query(`INSERT INTO public.support_access_revocations(tenant_id,request_id,revoked_by,reason_hash,trace_id)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,request_id) DO NOTHING RETURNING request_id`,
          [session.tenantId,requestId,session.actorId,reasonHash,traceId]);
        if(added.rows?.length!==1)throw denied();
        await tx.query(`INSERT INTO public.support_access_events(tenant_id,request_id,actor_id,matter_id,event_type,resource_hash,trace_id)
          VALUES($1,$2,$3,$4,'REVOKED',$5,$6)`,
          [session.tenantId,requestId,session.actorId,r.rows[0].matter_id,r.rows[0].document_ref_hash,traceId]);
        return Object.freeze({requestId,status:'REVOKED'});
      });
    }catch{throw denied();}
  }
}

export function createTenantScopedPostgresSupportGrantMutations({pool,expectedRole,timeoutMs=3000,liveSession}={}){
  if(typeof expectedRole!=='string'||!/^legaltech_support_operator_[a-z0-9_]{1,30}$/.test(expectedRole))
    throw new Error('DURABLE_SUPPORT_MUTATION_CONFIGURATION_INVALID');
  const transaction=new PostgresTenantTransactions({pool,expectedRole,timeoutMs});
  return new PostgresSupportGrantMutations({liveSession,transact:(context,work)=>{
    if(context.readOnly!==false||!context.tenantId||!context.actorId)throw new Error('DURABLE_SUPPORT_MUTATION_UNAVAILABLE');
    return transaction.run({...context,readOnly:false},async tx=>{
      const proof=await tx.query(`SELECT
        pg_has_role(current_user,'legaltech_support_operator','MEMBER') AS member,
        row_security_active('public.support_access_requests'::regclass) AS rls_request,
        row_security_active('public.support_access_approvals'::regclass) AS rls_approval,
        row_security_active('public.support_access_revocations'::regclass) AS rls_revocation,
        row_security_active('public.support_access_events'::regclass) AS rls_event,
        has_table_privilege(current_user,'public.support_access_requests','UPDATE,DELETE,TRUNCATE') AS request_mutation,
        has_table_privilege(current_user,'public.support_access_approvals','UPDATE,DELETE,TRUNCATE') AS approval_mutation,
        has_table_privilege(current_user,'public.support_access_revocations','UPDATE,DELETE,TRUNCATE') AS revocation_mutation,
        has_table_privilege(current_user,'public.support_access_events','SELECT,UPDATE,DELETE,TRUNCATE') AS event_read_mutation`);
      const r=proof.rows?.[0];
      if(proof.rows?.length!==1||r.member!==true||r.rls_request!==true||r.rls_approval!==true||
        r.rls_revocation!==true||r.rls_event!==true||r.request_mutation!==false||
        r.approval_mutation!==false||r.revocation_mutation!==false||r.event_read_mutation!==false)
        throw new Error('DURABLE_SUPPORT_MUTATION_UNAVAILABLE');
      return work(tx);
    });
  }});
}
