import crypto from 'node:crypto';
const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
function own(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)return undefined;if(!Object.hasOwn(descriptor,'value'))throw Error('inbound evidence unavailable');return descriptor.value;}
const timestamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const count=value=>Number.isSafeInteger(value)&&value>=0;
export const inboundRecoveryFingerprint=(eventId,actorId)=>crypto.createHash('sha256').update(JSON.stringify([eventId,actorId])).digest('hex');
export function boundInboundJob(job,event){
  try{
    if(!record(job)||!record(event))return false;
    if(!identifier(own(event,'id'))||!identifier(own(event,'tenantId'))||!identifier(own(job,'id'))||own(job,'tenantId')!==own(event,'tenantId')||own(job,'traceId')!==own(event,'traceId')||!identifier(own(event,'traceId'))||own(job,'type')!=='PROCESS_INBOUND')return false;
    const status=own(job,'status'),attempts=own(job,'attempts'),payload=own(job,'payload');
    if(!['QUEUED','RUNNING','DONE','DEAD','CANCELLED'].includes(status)||!count(attempts)||(['RUNNING','DONE','DEAD','CANCELLED'].includes(status)&&attempts<1)||(status==='QUEUED'&&attempts>=Number.MAX_SAFE_INTEGER)||!record(payload)||own(payload,'eventId')!==own(event,'id'))return false;
    for(const field of ['updatedAt','createdAt','availableAt'])if(!timestamp(own(job,field)))return false;
    const recovery=own(payload,'recovery'),actor=own(payload,'recoveryActor'),fingerprint=own(payload,'recoveryFingerprint');
    if(recovery!==undefined&&(!count(recovery)||recovery<1))return false;
    // Legacy recovery jobs lack attribution; present proof must always agree.
    if(actor!==undefined||fingerprint!==undefined){if(recovery===undefined||!identifier(actor)||fingerprint!==inboundRecoveryFingerprint(event.id,actor))return false;}
    return true;
  }catch{return false;}
}
export function hasInboundDecisionEvidence(event){
  const fields=['approvedBy','approvedMatterId','approvedExceptionId','writeback','rejectedBy','rejectedExceptionId','rejectionNotes','classification','match'];
  return fields.some(field=>Object.hasOwn(event,field)&&event[field]!==null&&event[field]!==undefined)||event.processing?.state==='COMPLETED'||event.processing?.evidenceVersion!=null||event.processing?.evidenceFingerprint!=null;
}
export function collectInboundEvidence(store,event){
  const jobs=store.listEventJobs(event.tenantId,event.id);
  if(!Array.isArray(jobs)||!jobs.length||jobs.some(job=>!boundInboundJob(job,event))||new Set(jobs.map(job=>job.id)).size!==jobs.length)throw Error('inbound evidence unavailable');
  if(!jobs.some(job=>job.payload.recovery===undefined))throw Error('inbound evidence unavailable');
  let totalAttempts=0,maxRecovery=0;const recoveries=new Set();
  for(const job of jobs){totalAttempts+=job.attempts;if(!count(totalAttempts))throw Error('inbound evidence unavailable');const recovery=job.payload.recovery??0;if(recovery){recoveries.add(recovery);maxRecovery=Math.max(maxRecovery,recovery);}}
  const recoveryCount=event.processing?.recoveryCount??0;
  if(!count(recoveryCount)||recoveryCount!==maxRecovery||recoveries.size!==maxRecovery)throw Error('inbound evidence unavailable');
  if(maxRecovery){const currentCycle=jobs.filter(job=>job.payload.recovery===maxRecovery);const pointer=event.processing?.jobId;if(pointer!=null?!currentCycle.some(job=>job.id===pointer):currentCycle.length!==1)throw Error('inbound evidence unavailable');}
  return {jobs,latest:jobs[0],totalAttempts,recoveryCount};
}
export function expiredInboundClaim(job,now=Date.now()){
  return job.status==='RUNNING'&&timestamp(job.updatedAt)&&Date.parse(job.updatedAt)<=now-300000;
}

export function activeInboundCycle(store,job,event){
  const evidence=collectInboundEvidence(store,event);
  if(!evidence.jobs.some(item=>item.id===job.id)||(job.payload.recovery??0)!==evidence.recoveryCount)return false;
  return !evidence.recoveryCount||event.processing?.jobId==null||event.processing.jobId===job.id;
}
