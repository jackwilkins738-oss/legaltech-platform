import {boundInboundJob,hasInboundDecisionEvidence,collectInboundEvidence,expiredInboundClaim,inboundRecoveryFingerprint} from './inboundJobEvidence.js';
import {appError} from './errors.js';
const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const conflict=()=>appError('processing state does not permit recovery',{status:409,code:'INVALID_PROCESSING_STATE'});
const identifier=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value);
const recoveryFingerprint=inboundRecoveryFingerprint;
const expired=job=>expiredInboundClaim(job);
function unavailableView(event){
  return {...event,status:event.status==='QUEUED'?'PROCESSING_UNAVAILABLE':event.status,
    processing:{...event.processing,state:'UNAVAILABLE',jobId:null,attempts:null,totalAttempts:null,recoveryCount:null,errorCode:'PROCESSING_EVIDENCE_UNAVAILABLE'}};
}

export function inboundEventView(store,event) {
  if (!event) return null;
  let evidence;
  try{evidence=collectInboundEvidence(store,event);}catch{return unavailableView(event);}
  const {jobs,latest,totalAttempts,recoveryCount}=evidence;
  const active=jobs.filter(job=>['QUEUED','RUNNING'].includes(job.status));
  let state=event.processing?.state||'PENDING',status=event.status;
  if(event.status==='QUEUED'){
    if(hasInboundDecisionEvidence(event))return unavailableView(event);
    if(!active.length&&latest.status==='DEAD'){state='FAILED';status='PROCESSING_FAILED';}
    else if(!active.length)return unavailableView(event);
    else if(active.every(expired)){state='STALLED';status='PROCESSING_STALLED';}
    else state=active.some(job=>job.status==='RUNNING')?'RUNNING':'QUEUED';
  }
  return {...event,status,processing:{...event.processing,state,jobId:latest.id,attempts:latest.attempts,
    totalAttempts,recoveryCount,errorCode:['FAILED','STALLED'].includes(state)?state==='FAILED'?'INBOUND_PROCESSING_FAILED':'WORKER_LEASE_EXPIRED':null}};
}

export function requestInboundRecovery(store,{tenantId,eventId,actorId,idempotencyKey}) {
  if (!identifier(idempotencyKey)) throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
  if (!identifier(actorId)) throw appError('actor required',{code:'ACTOR_REQUIRED'});
  return store.transaction(()=>{
    const event=store.getEvent(tenantId,eventId);
    if (!event||event.id!==eventId||event.tenantId!==tenantId) throw unavailable();
    const scope=JSON.stringify(['inbound-recovery',tenantId,idempotencyKey]),previous=store.getIdempotent(scope);
    const fingerprint=recoveryFingerprint(eventId,actorId);
    if (previous) {
      const job=typeof previous.jobId==='string'?store.getJob(previous.jobId):null;
      if (previous.eventId!==eventId) throw appError('idempotency key conflicts with prior recovery',{status:409,code:'IDEMPOTENCY_CONFLICT'});
      if(!boundInboundJob(job,event)||!Number.isSafeInteger(job.payload?.recovery)||job.payload.recovery<1)throw unavailable();
      if(!previous.requestFingerprint||!previous.actorId)throw appError('original recovery request cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
      if(previous.requestFingerprint!==fingerprint||previous.actorId!==actorId)throw appError('idempotency key conflicts with prior recovery',{status:409,code:'IDEMPOTENCY_CONFLICT'});
      if(job.payload.recoveryActor!==actorId||job.payload.recoveryFingerprint!==fingerprint)throw unavailable();
      return {eventId:event.id,jobId:job.id,status:'QUEUED',recoveryCount:job.payload.recovery,replayed:true};
    }
    if (event.status!=='QUEUED'||hasInboundDecisionEvidence(event)) throw conflict();
    let evidence;try{evidence=collectInboundEvidence(store,event);}catch{throw conflict();}
    const {jobs,latest}=evidence;
    const original=structuredClone(event);
    const active=jobs.filter(job=>['QUEUED','RUNNING'].includes(job.status));
    if (active.some(job=>!expired(job))||(!active.length&&latest.status!=='DEAD')) throw conflict();
    const priorCount=event.processing?.recoveryCount??0;
    if(!Number.isSafeInteger(priorCount)||priorCount<0||priorCount>=Number.MAX_SAFE_INTEGER)throw conflict();
    // Expired classifiers can finish later, but retired jobs cannot commit their output.
    for (const job of active) if (store.cancelInboundJob(tenantId,job.id,{expected:job})!==1) throw conflict();
    const recoveryCount=priorCount+1;
    const queued=store.enqueue({tenantId,type:'PROCESS_INBOUND',payload:{eventId,recovery:recoveryCount,recoveryActor:actorId,recoveryFingerprint:fingerprint},traceId:event.traceId});
    if(!boundInboundJob(queued,event))throw conflict();
    const job=store.getJob(queued.id);
    if(!boundInboundJob(job,event)||job.status!=='QUEUED'||job.attempts!==0||Object.keys(job.payload).length!==4||job.payload.recovery!==recoveryCount||job.payload.recoveryActor!==actorId||job.payload.recoveryFingerprint!==fingerprint)throw conflict();
    event.processing={state:'QUEUED',jobId:job.id,recoveryCount};
    if(!store.updateRecoveryEvent(event,original))throw conflict();
    store.audit({tenantId,traceId:event.traceId,action:'INBOUND_RECOVERY_REQUESTED',objectId:eventId,actorId,
      outcome:'SUCCESS',reason:active.length?'WORKER_LEASE_EXPIRED':'PROCESSING_EXHAUSTED'});
    const result={eventId,jobId:job.id,status:'QUEUED',recoveryCount,replayed:false};
    store.setIdempotent(scope,{...result,actorId,requestFingerprint:fingerprint});
    return result;
  });
}
