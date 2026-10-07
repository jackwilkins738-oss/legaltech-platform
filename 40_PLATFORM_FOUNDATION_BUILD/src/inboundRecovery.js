import {appError} from './errors.js';
const LEASE_MS=300000;
const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const conflict=()=>appError('processing state does not permit recovery',{status:409,code:'INVALID_PROCESSING_STATE'});
const expired=job=>job.status==='RUNNING'&&Number.isFinite(Date.parse(job.updatedAt))&&Date.parse(job.updatedAt)<=Date.now()-LEASE_MS;

export function inboundEventView(store,event) {
  if (!event) return null;
  const jobs=store.listEventJobs(event.tenantId,event.id),latest=jobs[0];
  if (!latest) return event;
  const active=jobs.filter(job=>['QUEUED','RUNNING'].includes(job.status));
  let state=event.processing?.state||'PENDING',status=event.status;
  if (event.status==='QUEUED') {
    if (!active.length&&latest.status==='DEAD') {state='FAILED';status='PROCESSING_FAILED';}
    else if (active.length&&active.every(expired)) {state='STALLED';status='PROCESSING_STALLED';}
    else state=active.some(job=>job.status==='RUNNING')?'RUNNING':'QUEUED';
  }
  const totalAttempts=jobs.reduce((sum,job)=>sum+job.attempts,0);
  return {...event,status,processing:{...event.processing,state,jobId:latest.id,attempts:latest.attempts,
    totalAttempts,recoveryCount:event.processing?.recoveryCount||0,
    errorCode:['FAILED','STALLED'].includes(state)?state==='FAILED'?'INBOUND_PROCESSING_FAILED':'WORKER_LEASE_EXPIRED':null}};
}

export function requestInboundRecovery(store,{tenantId,eventId,actorId,idempotencyKey}) {
  if (typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>200) throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
  if (typeof actorId!=='string'||!actorId.trim()) throw appError('actor required',{code:'ACTOR_REQUIRED'});
  return store.transaction(()=>{
    const event=store.getEvent(tenantId,eventId);
    if (!event) throw unavailable();
    const scope=JSON.stringify(['inbound-recovery',tenantId,idempotencyKey]),previous=store.getIdempotent(scope);
    if (previous) {
      const job=typeof previous.jobId==='string'?store.getJob(previous.jobId):null;
      if (previous.eventId!==eventId) throw appError('idempotency key conflicts with prior recovery',{status:409,code:'IDEMPOTENCY_CONFLICT'});
      if (!job||job.tenantId!==tenantId||job.type!=='PROCESS_INBOUND'||job.payload?.eventId!==eventId) throw unavailable();
      return {...previous,replayed:true};
    }
    if (event.status!=='QUEUED'||event.approvedBy||event.approvedMatterId||event.writeback) throw conflict();
    const jobs=store.listEventJobs(tenantId,eventId),latest=jobs[0];
    if (!latest) throw conflict();
    const active=jobs.filter(job=>['QUEUED','RUNNING'].includes(job.status));
    if (active.some(job=>!expired(job))||(!active.length&&latest.status!=='DEAD')) throw conflict();
    // Expired classifiers can finish later, but retired jobs cannot commit their output.
    for (const job of active) if (store.cancelInboundJob(tenantId,job.id)!==1) throw conflict();
    const recoveryCount=(event.processing?.recoveryCount||0)+1;
    const job=store.enqueue({tenantId,type:'PROCESS_INBOUND',payload:{eventId,recovery:recoveryCount},traceId:event.traceId});
    event.processing={state:'QUEUED',jobId:job.id,recoveryCount};
    store.updateEvent(event);
    store.audit({tenantId,traceId:event.traceId,action:'INBOUND_RECOVERY_REQUESTED',objectId:eventId,actorId,
      outcome:'SUCCESS',reason:active.length?'WORKER_LEASE_EXPIRED':'PROCESSING_EXHAUSTED'});
    const result={eventId,jobId:job.id,status:'QUEUED',recoveryCount,replayed:false};
    store.setIdempotent(scope,result);
    return result;
  });
}
