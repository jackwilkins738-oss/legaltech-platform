import crypto from 'node:crypto';
import {appError} from './errors.js';
import {writebackScope} from './writeback.js';
const identifier=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const changed=()=>appError('idempotency key conflicts with prior decision',{status:409,code:'IDEMPOTENCY_CONFLICT'});
export const approvalScope=(tenant,key)=>JSON.stringify(['approval-v48',tenant,'approve',key]);
export const approvalFingerprint=(matterId,exceptionId,actorId)=>crypto.createHash('sha256').update(JSON.stringify([matterId,exceptionId,actorId])).digest('hex');
export function normalizeApprovalRequest({matterId=null,exceptionId=null,actorId,idempotencyKey}) {
  // The internal review key adds "resolve:" to a public key of up to 200 characters.
  if(!identifier(idempotencyKey,208))throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
  if(!identifier(actorId))throw appError('actor required',{code:'ACTOR_REQUIRED'});
  if((matterId!==null&&!identifier(matterId))||(exceptionId!==null&&!identifier(exceptionId)))throw appError('invalid approval request',{code:'INVALID_REQUEST'});
  return {matterId,exceptionId,actorId,idempotencyKey};
}
export function replayApproval(store,{tenantId,event,request,previous}) {
  if(typeof previous.eventId!=='string'||!store.getEvent(tenantId,previous.eventId))throw unavailable();
  if(previous.eventId!==event.id)throw changed();
  const {idempotencyKey,actorId,matterId,exceptionId}=request;
  const target=event.approvedMatterId,matter=typeof target==='string'?store.getMatter(tenantId,target):null;
  const job=typeof previous.jobId==='string'?store.getJob(previous.jobId):null;
  const command=store.getIdempotent(writebackScope(tenantId,idempotencyKey));
  if(!['APPROVED','COMPLETED','OUTCOME_UNKNOWN','RECONCILING','RECONCILIATION_FAILED','WRITE_FAILED'].includes(event.status)||
      !matter||previous.matterId!==target||!event.approvedBy||event.writeback?.commandKey!==idempotencyKey||
      !job||job.tenantId!==tenantId||job.type!=='PROCLAIM_WRITEBACK'||job.traceId!==event.traceId||
      job.payload?.eventId!==event.id||job.payload?.matterId!==target||job.payload?.approvalKey!==idempotencyKey||
      !command||command.tenantId!==tenantId||command.eventId!==event.id||command.matterId!==target||command.key!==idempotencyKey||
      command.externalMatterId!==matter.externalId||command.actorId!==event.approvedBy||command.traceId!==event.traceId||
      command.classification!==(event.classification?.classification||'UNKNOWN'))throw unavailable();
  let recordedException;
  if(Object.hasOwn(event,'approvedExceptionId'))recordedException=event.approvedExceptionId;
  else if(event.processing?.exceptionId)recordedException=event.processing.exceptionId;
  else {
    // Legacy ready approvals had no exception. Prove a legacy reviewed approval
    // from its one resolved owned exception rather than trust a caller/cache ID.
    const resolved=store.listExceptions(tenantId,'RESOLVED').filter(ex=>ex.eventId===event.id&&ex.resolution==='APPROVED');
    if(resolved.length>1)throw appError('original approval cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
    recordedException=resolved[0]?.id??null;
  }
  if(recordedException!==null) {
    const ex=typeof recordedException==='string'?store.getException(tenantId,recordedException):null;
    if(!ex||ex.eventId!==event.id||ex.status!=='RESOLVED'||ex.resolution!=='APPROVED'||ex.matterId!==target||ex.resolvedBy!==event.approvedBy)throw unavailable();
  }
  if(actorId!==event.approvedBy||(matterId!==null&&matterId!==target)||(exceptionId!==null&&exceptionId!==recordedException))throw changed();
  const fingerprint=approvalFingerprint(target,recordedException,actorId);
  if(previous.requestFingerprint&&previous.requestFingerprint!==fingerprint)throw changed();
  const result={eventId:event.id,jobId:job.id,status:'APPROVED',matterId:target,replayed:false};
  store.setIdempotent(approvalScope(tenantId,idempotencyKey),{...result,requestFingerprint:fingerprint});
  return {...result,replayed:true};
}
