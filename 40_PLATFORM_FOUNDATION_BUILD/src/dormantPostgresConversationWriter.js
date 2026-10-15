import {randomUUID} from 'node:crypto';
import {pinConversationCommand} from './durableConversationCommand.js';
import {pinSupportSession} from './supportAuthorityInput.js';

const denied=()=>new Error('DURABLE_CONVERSATION_DENIED');
const same=(a,b)=>a===b;
const one=result=>result?.rows?.length===1?result.rows[0]:null;

/**
 * Dormant PostgreSQL mutation reference. No pool factory, grants, HTTP routing
 * or production activation. transact and authorize MUST be trusted server code.
 * The caller must supply a database transaction bound to pinned tenant/actor.
 */
export class DormantPostgresConversationWriter {
  #transact;#authorize;
  constructor({transact,authorize}={}){
    if(typeof transact!=='function'||typeof authorize!=='function')
      throw new Error('DURABLE_CONVERSATION_CONFIGURATION_INVALID');
    this.#transact=transact;this.#authorize=authorize;
  }
  async execute({session,command}={}){
    const identity=pinSupportSession(session,denied);
    const input=pinConversationCommand(command);
    try{
      return await this.#transact(Object.freeze({tenantId:identity.tenantId,actorId:identity.actorId,readOnly:false}),async tx=>{
        if(typeof tx?.query!=='function')throw denied();
        if(input.kind==='CREATE')return this.#create(tx,identity,input);
        // Thread lock serializes all writes and participant revocations across
        // independent app servers using the same PostgreSQL primary.
        const thread=one(await tx.query(
          'SELECT id,matter_id,creator_actor_id,revision FROM public.matter_conversation_threads WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [identity.tenantId,input.threadId]));
        if(!thread)throw denied();
        const member=one(await tx.query(
          'SELECT actor_id FROM public.matter_conversation_participants WHERE tenant_id=$1 AND thread_id=$2 AND actor_id=$3 AND revoked_at IS NULL',
          [identity.tenantId,input.threadId,identity.actorId]));
        if(!member)throw denied();
        if(await this.#authorize(Object.freeze({tx,identity,kind:input.kind,matterId:thread.matter_id,threadId:input.threadId}))!==true)throw denied();
        if(input.kind==='POST')return this.#post(tx,identity,input,thread);
        if(input.kind==='PARTICIPANTS')return this.#participants(tx,identity,input,thread);
        throw denied();
      });
    }catch{throw denied();}
  }
  async #create(tx,identity,input){
    if(await this.#authorize(Object.freeze({tx,identity,kind:'CREATE',matterId:input.matterId}))!==true)throw denied();
    const participants=[...new Set([...input.participantIds,identity.actorId])];
    if(participants.length>25)throw denied();
    const threadId=randomUUID();
    const created=one(await tx.query(
      'INSERT INTO public.matter_conversation_threads(id,tenant_id,matter_id,creator_actor_id,subject,revision) VALUES($1,$2,$3,$4,$5,1) RETURNING id',
      [threadId,identity.tenantId,input.matterId,identity.actorId,input.subject]));
    if(!created||!same(created.id,threadId))throw denied();
    for(const actorId of participants){
      const result=await tx.query(
        'INSERT INTO public.matter_conversation_participants(tenant_id,thread_id,actor_id) VALUES($1,$2,$3) RETURNING actor_id',
        [identity.tenantId,threadId,actorId]);
      if(!one(result))throw denied();
    }
    if(!one(await tx.query(
      "INSERT INTO public.matter_conversation_audit(tenant_id,thread_id,actor_id,revision,kind) VALUES($1,$2,$3,1,'CREATED') RETURNING revision",
      [identity.tenantId,threadId,identity.actorId])))throw denied();
    return Object.freeze({threadId,revision:1,kind:'CREATED'});
  }
  async #post(tx,identity,input,thread){
    // Lock has already been acquired before the membership/authorization check.
    // Immutable retry receipts are scoped by tenant, thread and author.
    const prior=one(await tx.query(
      'SELECT id,body FROM public.matter_conversation_messages WHERE tenant_id=$1 AND thread_id=$2 AND author_actor_id=$3 AND request_id=$4',
      [identity.tenantId,input.threadId,identity.actorId,input.requestId]));
    if(prior){
      if(prior.body!==input.body)throw denied();
      return Object.freeze({messageId:prior.id,threadId:input.threadId,replayed:true});
    }
    const revision=Number(thread.revision);
    if(!Number.isSafeInteger(revision)||revision<1)throw denied();
    const messageId=randomUUID();
    if(!one(await tx.query(
      'INSERT INTO public.matter_conversation_messages(id,tenant_id,thread_id,author_actor_id,request_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [messageId,identity.tenantId,input.threadId,identity.actorId,input.requestId,input.body])))throw denied();
    const updated=one(await tx.query(
      'UPDATE public.matter_conversation_threads SET revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision',
      [identity.tenantId,input.threadId,revision]));
    if(!updated||Number(updated.revision)!==revision+1)throw denied();
    if(!one(await tx.query(
      "INSERT INTO public.matter_conversation_audit(tenant_id,thread_id,actor_id,revision,kind) VALUES($1,$2,$3,$4,'MESSAGE_POSTED') RETURNING revision",
      [identity.tenantId,input.threadId,identity.actorId,revision+1])))throw denied();
    return Object.freeze({messageId,threadId:input.threadId,revision:revision+1,replayed:false});
  }
  async #participants(tx,identity,input,thread){
    if(thread.creator_actor_id!==identity.actorId||Number(thread.revision)!==input.expectedRevision)throw denied();
    const members=new Set([...input.participantIds,identity.actorId]);
    if(members.size>25)throw denied();
    // Never physically remove memberships: revoke under the common thread lock.
    const old=await tx.query(
      'SELECT actor_id FROM public.matter_conversation_participants WHERE tenant_id=$1 AND thread_id=$2 AND revoked_at IS NULL',
      [identity.tenantId,input.threadId]);
    if(!Array.isArray(old?.rows))throw denied();
    for(const row of old.rows){
      if(!members.has(row.actor_id))await tx.query(
        'UPDATE public.matter_conversation_participants SET revoked_at=statement_timestamp() WHERE tenant_id=$1 AND thread_id=$2 AND actor_id=$3 AND revoked_at IS NULL',
        [identity.tenantId,input.threadId,row.actor_id]);
    }
    for(const actorId of members){
      await tx.query(
        'INSERT INTO public.matter_conversation_participants(tenant_id,thread_id,actor_id,revoked_at) VALUES($1,$2,$3,NULL) ON CONFLICT(tenant_id,thread_id,actor_id) DO UPDATE SET revoked_at=NULL',
        [identity.tenantId,input.threadId,actorId]);
    }
    const updated=one(await tx.query(
      'UPDATE public.matter_conversation_threads SET revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision',
      [identity.tenantId,input.threadId,input.expectedRevision]));
    if(!updated||Number(updated.revision)!==input.expectedRevision+1)throw denied();
    if(!one(await tx.query(
      "INSERT INTO public.matter_conversation_audit(tenant_id,thread_id,actor_id,revision,kind) VALUES($1,$2,$3,$4,'PARTICIPANTS_CHANGED') RETURNING revision",
      [identity.tenantId,input.threadId,identity.actorId,input.expectedRevision+1])))throw denied();
    return Object.freeze({threadId:input.threadId,revision:input.expectedRevision+1,participantCount:members.size});
  }
}
