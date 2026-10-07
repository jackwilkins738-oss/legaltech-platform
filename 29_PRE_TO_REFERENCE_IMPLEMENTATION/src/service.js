import { matchMatter } from './matcher.js';

const suspicious = /ignore all prior instructions|search every client|exfiltrat|reveal secrets/i;

export class LegalOpsService {
  constructor({store, proclaim}) { this.store=store; this.proclaim=proclaim; }

  ingest(tenantId, input, idemKey) {
    if (!idemKey) throw Object.assign(new Error('Idempotency-Key required'), {status:400, code:'IDEMPOTENCY_REQUIRED'});
    const scope=`${tenantId}:inbound:${idemKey}`;
    if (this.store.idempotency.has(scope)) return this.store.idempotency.get(scope);

    const eventId=this.store.uid('evt');
    const match=matchMatter({tenantId,subject:input.subject,body:input.body,store:this.store});
    let exception=null;
    if (suspicious.test(`${input.subject||''}\n${input.body||''}`)) {
      match.decision='BLOCK'; match.reason='adversarial_content'; match.matterId=null;
    }
    if (match.decision !== 'AUTO') {
      exception={id:this.store.uid('exc'),tenantId,eventId,type:match.decision==='BLOCK'?'SECURITY':'MATCH',status:'OPEN',reason:match.reason};
      this.store.exceptions.set(exception.id,exception);
    }
    const event={id:eventId,tenantId,sourceSystem:input.sourceSystem||'MANUAL_UPLOAD',externalEventId:input.externalEventId||eventId,subject:input.subject||'',body:input.body||'',match,exceptionId:exception?.id||null};
    this.store.events.set(eventId,event);
    const result={eventId,match,exceptionId:exception?.id||null};
    this.store.idempotency.set(scope,result);
    this.store.audit({tenantId,action:'INBOUND_INGESTED',objectId:eventId,outcome:'SUCCESS',reason:match.reason});
    return result;
  }

  listExceptions(tenantId) {
    return [...this.store.exceptions.values()].filter(x=>x.tenantId===tenantId).map(x => structuredClone(x));
  }

  resolveException(tenantId, exceptionId, resolution, matterId) {
    const e=this.store.exceptions.get(exceptionId);
    if (!e || e.tenantId!==tenantId) return null;
    if (matterId && !this.store.getMatter(tenantId,matterId)) throw Object.assign(new Error('Matter unavailable'),{status:404,code:'NOT_FOUND'});
    e.status='RESOLVED'; e.resolution=resolution; e.matterId=matterId||null;
    this.store.audit({tenantId,action:'EXCEPTION_RESOLVED',objectId:exceptionId,matterId:matterId||null,outcome:'SUCCESS'});
    return structuredClone(e);
  }

  async writeback(tenantId, input, idemKey) {
    if (!idemKey) throw Object.assign(new Error('Idempotency-Key required'), {status:400, code:'IDEMPOTENCY_REQUIRED'});
    const matter=this.store.getMatter(tenantId,input.matterId);
    if (!matter) throw Object.assign(new Error('Matter unavailable'),{status:404,code:'NOT_FOUND'});
    const scope=`${tenantId}:proclaim:${idemKey}`;
    if (this.store.idempotency.has(scope)) return this.store.idempotency.get(scope);
    const result=await this.proclaim.createHistory({tenantId,externalMatterId:matter.proclaimId,idempotencyKey:idemKey,payload:input.payload||{}});
    const readback=await this.proclaim.getHistory({tenantId,externalMatterId:matter.proclaimId});
    const verified=readback.some(x=>x.id===result.externalWriteId);
    const out={externalWriteId:result.externalWriteId,verified};
    this.store.idempotency.set(scope,out);
    this.store.audit({tenantId,action:'PROCLAIM_WRITEBACK',objectId:result.externalWriteId,matterId:matter.id,outcome:verified?'SUCCESS':'FAILED'});
    return out;
  }

  audits(tenantId) { return this.store.audits.filter(a=>a.tenantId===tenantId).map(x => structuredClone(x)); }
}
