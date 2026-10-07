import { matchMatter } from './matcher.js';
const suspicious=/ignore all prior instructions|search every client|exfiltrat|reveal secrets/i;

export class PersistentLegalOpsService {
  constructor({store,proclaim}) { this.store=store; this.proclaim=proclaim; }
  ingest(tenantId,input,idemKey) {
    if(!idemKey) throw Object.assign(new Error('Idempotency-Key required'),{status:400,code:'IDEMPOTENCY_REQUIRED'});
    const scope=`${tenantId}:inbound:${idemKey}`; const existing=this.store.getIdempotent(scope); if(existing) return existing;
    const eventId=this.store.uid('evt');
    const match=matchMatter({tenantId,subject:input.subject,body:input.body,store:this.store});
    let exception=null;
    if(suspicious.test(`${input.subject||''}\n${input.body||''}`)){match.decision='BLOCK';match.reason='adversarial_content';match.matterId=null;}
    if(match.decision!=='AUTO') { exception={id:this.store.uid('exc'),tenantId,eventId,type:match.decision==='BLOCK'?'SECURITY':'MATCH',status:'OPEN',reason:match.reason}; this.store.putException(exception); }
    const event={id:eventId,tenantId,sourceSystem:input.sourceSystem||'MANUAL_UPLOAD',externalEventId:input.externalEventId||eventId,subject:input.subject||'',body:input.body||'',match,exceptionId:exception?.id||null};
    this.store.putEvent(event); const result={eventId,match,exceptionId:exception?.id||null}; this.store.setIdempotent(scope,result);
    this.store.audit({tenantId,action:'INBOUND_INGESTED',objectId:eventId,outcome:'SUCCESS',reason:match.reason}); return result;
  }
  listExceptions(tenantId){return this.store.listExceptions(tenantId);}
  resolveException(tenantId,id,resolution,matterId){const e=this.store.getException(tenantId,id); if(!e)return null; if(matterId&&!this.store.getMatter(tenantId,matterId))throw Object.assign(new Error('Matter unavailable'),{status:404,code:'NOT_FOUND'}); e.status='RESOLVED';e.resolution=resolution;e.matterId=matterId||null;this.store.updateException(e);this.store.audit({tenantId,action:'EXCEPTION_RESOLVED',objectId:id,matterId:matterId||null,outcome:'SUCCESS'});return e;}
  async writeback(tenantId,input,idemKey){if(!idemKey)throw Object.assign(new Error('Idempotency-Key required'),{status:400,code:'IDEMPOTENCY_REQUIRED'});const matter=this.store.getMatter(tenantId,input.matterId);if(!matter)throw Object.assign(new Error('Matter unavailable'),{status:404,code:'NOT_FOUND'});const scope=`${tenantId}:proclaim:${idemKey}`;const existing=this.store.getIdempotent(scope);if(existing)return existing;const result=await this.proclaim.createHistory({tenantId,externalMatterId:matter.proclaimId,idempotencyKey:idemKey,payload:input.payload||{}});const readback=await this.proclaim.getHistory({tenantId,externalMatterId:matter.proclaimId});const verified=readback.some(x=>x.id===result.externalWriteId);const out={externalWriteId:result.externalWriteId,verified};this.store.setIdempotent(scope,out);this.store.audit({tenantId,action:'PROCLAIM_WRITEBACK',objectId:result.externalWriteId,matterId:matter.id,outcome:verified?'SUCCESS':'FAILED'});return out;}
  audits(tenantId){return this.store.listAudits(tenantId);}
  enqueue(tenantId,type,payload){const job=this.store.enqueue({tenantId,type,payload});this.store.audit({tenantId,action:'JOB_ENQUEUED',objectId:job.id,outcome:'SUCCESS',reason:type});return job;}
}
