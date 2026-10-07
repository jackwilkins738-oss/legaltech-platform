import {appError} from './errors.js';
const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const conflict=()=>appError('review decision already recorded',{status:409,code:'INVALID_REVIEW_STATE'});
const approvalFields=['approvedBy','approvedMatterId','approvedExceptionId','writeback'];
const hasEvidence=(event,fields)=>fields.some(key=>Object.hasOwn(event,key)&&event[key]!==null&&event[key]!==undefined);

export function assertReviewIdentity({tenantId,exceptionId,event,exception}) {
  if(!event||!exception||exception.id!==exceptionId||exception.tenantId!==tenantId||event.tenantId!==tenantId||event.id!==exception.eventId) throw unavailable();
}
export function assertUndecidedEvent(event) {
  if(hasEvidence(event,[...approvalFields,'rejectedBy','rejectedExceptionId','rejectionNotes'])) throw conflict();
}
export function assertOpenReview(store,{tenantId,event,exception}) {
  if(event.status!=='REVIEW_REQUIRED'||exception.status!=='OPEN'||hasEvidence(exception,['resolution','resolvedBy','matterId'])) throw conflict();
  const link=event.processing?.exceptionId;
  if(link!==null&&link!==undefined) {
    if(typeof link!=='string'||link!==exception.id) throw conflict();
  } else {
    // Historical rows without a processing link require one unambiguous owned exception.
    const owned=store.listExceptions(tenantId,'OPEN').filter(ex=>ex.tenantId===tenantId&&ex.eventId===event.id);
    if(owned.length!==1||owned[0].id!==exception.id) throw conflict();
  }
}
export function assertRejectedReview(store,{tenantId,event,exception,notes}) {
  if(event.status!=='REJECTED'||event.rejectionNotes!==notes||hasEvidence(event,approvalFields)) throw unavailable();
  const recorded=event.rejectedExceptionId;
  const processing=event.processing?.exceptionId;
  if(recorded!==undefined&&recorded!==exception.id) throw unavailable();
  if(processing!==null&&processing!==undefined&&processing!==exception.id) throw unavailable();
  if(recorded===undefined&&(processing===null||processing===undefined)) {
    const resolved=store.listExceptions(tenantId,'RESOLVED').filter(ex=>ex.tenantId===tenantId&&ex.eventId===event.id&&ex.resolution==='REJECTED');
    if(resolved.length!==1) throw appError('original review request cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
    if(resolved[0].id!==exception.id) throw unavailable();
  }
}
export function commitReviewEvent(store,event,original) {
  if(!store.updateReviewEvent(event,original)) throw conflict();
}
export function commitReviewException(store,exception,original) {
  if(!store.updateReviewException(exception,original)) throw conflict();
}
// Preserve the append-only historical ledger while minimizing content on the audit surface.
export function reviewAuditView(entry) {
  return entry.action==='INBOUND_REJECTED'?{...entry,reason:'human_rejection'}:entry;
}
