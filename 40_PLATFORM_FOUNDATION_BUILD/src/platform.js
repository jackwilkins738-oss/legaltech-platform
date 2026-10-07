import {WritebackWorker, newWritebackCommand, writebackScope} from './writeback.js';
import crypto from 'node:crypto'; import {appError} from './errors.js'; import {inspectFile} from './fileSafety.js'; import {matchMatter} from './matcher.js';
export class Platform {
  constructor({store,objectStorage,aiGateway,proclaim,graph=null}){this.store=store;this.objectStorage=objectStorage;this.aiGateway=aiGateway;this.proclaim=proclaim;this.graph=graph;this.writebackWorker=new WritebackWorker({store,proclaim});}
  #trace(){return `trc_${crypto.randomUUID()}`;}
  ingest({tenantId,input,idempotencyKey}){
    if(!tenantId)throw appError('tenant required',{status:401,code:'TENANT_REQUIRED'}); if(!idempotencyKey)throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
    const scope=`${tenantId}:ingest:${idempotencyKey}`;const existing=this.store.getIdempotent(scope);if(existing)return {...existing,replayed:true};
    const traceId=this.#trace(),eventId=this.store.uid('evt'),attachments=[];
    for(const a of input.attachments||[]){const bytes=Buffer.isBuffer(a.bytes)?a.bytes:Buffer.from(a.bytes||'');const safety=inspectFile({filename:a.filename,bytes});let objectRef=null;if(safety.verdict==='SAFE_FOR_PARSER')objectRef=this.objectStorage.put({tenantId,bytes,contentType:a.contentType||'application/octet-stream',metadata:{filename:a.filename}}).objectRef;attachments.push({filename:a.filename,safety,objectRef});}
    const event={id:eventId,tenantId,traceId,status:'QUEUED',sourceSystem:input.sourceSystem||'MANUAL',externalEventId:input.externalEventId||null,subject:input.subject||'',body:input.body||'',attachments};this.store.putEvent(event);
    const job=this.store.enqueue({tenantId,type:'PROCESS_INBOUND',payload:{eventId},traceId});const result={eventId,jobId:job.id,traceId,status:'QUEUED',replayed:false};this.store.setIdempotent(scope,result);this.store.audit({tenantId,traceId,action:'INBOUND_ACCEPTED',objectId:eventId,outcome:'SUCCESS'});return result;
  }
  async processNext({tenantId=null,eventId=null}={}){const job=this.store.claimNext('PROCESS_INBOUND',tenantId,{eventId});if(!job)return null;try{const out=await this.#processInbound(job);this.store.completeJob(job.id);return {jobId:job.id,status:'DONE',result:out};}catch(e){this.store.failJob(job.id,e,{retry:job.attempts<3,delayMs:0});return {jobId:job.id,status:'FAILED',error:String(e.message||e)};}}
  async #processInbound(job){const e=this.store.getEvent(job.tenantId,job.payload.eventId);if(!e)throw new Error('event missing');const tenantId=e.tenantId,traceId=e.traceId;
    const unsafe=e.attachments.filter(a=>a.safety.verdict!=='SAFE_FOR_PARSER');const match=matchMatter({tenantId,subject:e.subject,body:e.body,store:this.store});const ai=await this.aiGateway.classifyInbound({authorizedContext:{subject:e.subject,body:e.body}});
    const needsReview=unsafe.length>0||match.decision!=='AUTO'||ai.status!=='OK';e.match=match;e.classification=ai;e.status=needsReview?'REVIEW_REQUIRED':'READY_FOR_APPROVAL';this.store.updateEvent(e);
    let exceptionId=null;if(needsReview){const ex={id:this.store.uid('exc'),tenantId,eventId:e.id,status:'OPEN',type:unsafe.length?'FILE_SAFETY':ai.status!=='OK'?'AI_SAFETY':'MATTER_MATCH',reason:unsafe.length?unsafe.map(x=>x.safety.reason).join(','):ai.status!=='OK'?ai.reason:match.reason,candidates:match.candidates||[]};this.store.putException(ex);exceptionId=ex.id;}
    this.store.audit({tenantId,traceId,action:'INBOUND_PROCESSED',objectId:e.id,matterId:match.matterId||null,outcome:needsReview?'REVIEW':'READY',reason:exceptionId||'policy_ready'});return {eventId:e.id,status:e.status,match,classification:ai,exceptionId};
  }
  getMatter(tenantId,matterId){return this.store.getMatter(tenantId,matterId);}
  listExceptions(tenantId){return this.store.listExceptions(tenantId,'OPEN');}
  resolveException({tenantId,exceptionId,resolution,matterId=null,notes=null,actorId='synthetic-reviewer',idempotencyKey}) {
    if (!idempotencyKey) throw appError('idempotency key required', {code:'IDEMPOTENCY_REQUIRED'});
    if (!['APPROVE','REJECT'].includes(resolution)) throw appError('unsupported resolution', {code:'INVALID_RESOLUTION'});
    return this.store.transaction(() => {
      const ex = this.store.getException(tenantId,exceptionId);
      if (!ex) throw appError('exception unavailable', {status:404,code:'NOT_FOUND'});
      const scope = `${tenantId}:exception-resolve:${idempotencyKey}`;
      const previous = this.store.getIdempotent(scope);
      if (previous) {
        if (previous.exceptionId !== exceptionId || previous.resolution !== resolution || (matterId && previous.matterId !== matterId)) throw appError('idempotency key conflicts with prior decision', {status:409,code:'IDEMPOTENCY_CONFLICT'});
        return {...previous,replayed:true};
      }
      const event = this.store.getEvent(tenantId,ex.eventId);
      if (!event) throw appError('event unavailable', {status:404,code:'NOT_FOUND'});
      if (ex.status !== 'OPEN' || event.status !== 'REVIEW_REQUIRED') throw appError('review decision already recorded', {status:409,code:'INVALID_REVIEW_STATE'});
      if (resolution === 'APPROVE') {
        const result = this.approve({tenantId,eventId:event.id,matterId,exceptionId,actorId,idempotencyKey:`resolve:${idempotencyKey}`});
        const out = {exceptionId,eventId:event.id,resolution:'APPROVE',status:'RESOLVED',matterId:result.matterId,jobId:result.jobId,replayed:false};
        this.store.setIdempotent(scope,out);
        return out;
      }
      ex.status='RESOLVED';ex.resolution='REJECTED';ex.resolvedBy=actorId;ex.notes=notes;
      this.store.updateException(ex);
      event.status='REJECTED';event.rejectedBy=actorId;event.rejectionNotes=notes;
      this.store.updateEvent(event);
      this.store.audit({tenantId,traceId:event.traceId,action:'INBOUND_REJECTED',objectId:event.id,actorId,outcome:'SUCCESS',reason:notes||'human_rejection'});
      const out = {exceptionId,eventId:event.id,resolution:'REJECT',status:'RESOLVED',replayed:false};
      this.store.setIdempotent(scope,out);
      return out;
    });
  }
  approve({tenantId,eventId,matterId=null,exceptionId=null,actorId='synthetic-reviewer',idempotencyKey}) {
    if (!idempotencyKey) throw appError('idempotency key required', {code:'IDEMPOTENCY_REQUIRED'});
    return this.store.transaction(() => {
      const event = this.store.getEvent(tenantId,eventId);
      if (!event) throw appError('event unavailable', {status:404,code:'NOT_FOUND'});
      const scope = `${tenantId}:approve:${idempotencyKey}`;
      const previous = this.store.getIdempotent(scope);
      if (previous) {
        if (previous.eventId !== eventId || (matterId && previous.matterId !== matterId)) throw appError('idempotency key conflicts with prior decision', {status:409,code:'IDEMPOTENCY_CONFLICT'});
        return {...previous,replayed:true};
      }
      if (!['READY_FOR_APPROVAL','REVIEW_REQUIRED'].includes(event.status)) throw appError('event cannot be approved again', {status:409,code:'INVALID_REVIEW_STATE'});
      const resolvedMatterId = matterId || event.match?.matterId;
      const matter = this.store.getMatter(tenantId,resolvedMatterId);
      if (!resolvedMatterId || !matter) throw appError('matter unavailable', {status:404,code:'NOT_FOUND'});
      if (exceptionId) {
        const ex = this.store.getException(tenantId,exceptionId);
        if (!ex || ex.eventId !== eventId) throw appError('exception unavailable', {status:404,code:'NOT_FOUND'});
        if (ex.status !== 'OPEN') throw appError('review decision already recorded', {status:409,code:'INVALID_REVIEW_STATE'});
        ex.status='RESOLVED';ex.resolution='APPROVED';ex.matterId=resolvedMatterId;ex.resolvedBy=actorId;
        this.store.updateException(ex);
      }
      event.status='APPROVED';event.approvedMatterId=resolvedMatterId;event.approvedBy=actorId;
      const job = this.store.enqueue({tenantId,type:'PROCLAIM_WRITEBACK',payload:{eventId,matterId:resolvedMatterId,approvalKey:idempotencyKey},traceId:event.traceId});
      const command = newWritebackCommand({tenantId,event,matter,key:idempotencyKey,jobId:job.id});
      this.store.setIdempotent(writebackScope(tenantId,idempotencyKey),command);
      event.writeback = {state:'PENDING',commandKey:idempotencyKey,verified:false,writeAttempts:0,reconciliationAttempts:0,totalReadAttempts:0,recoveryCount:0};
      this.store.updateEvent(event);
      const result = {eventId,jobId:job.id,status:'APPROVED',matterId:resolvedMatterId,replayed:false};
      this.store.setIdempotent(scope,result);
      this.store.audit({tenantId,traceId:event.traceId,action:'INBOUND_APPROVED',objectId:eventId,matterId:resolvedMatterId,actorId,outcome:'SUCCESS'});
      return result;
    });
  }
  async processWritebackNext(options) { return this.writebackWorker.processNext(options); }
  requestWritebackReconciliation(input) { return this.writebackWorker.requestReconciliation(input); }
  getEvent(tenantId,eventId){return this.store.getEvent(tenantId,eventId);}
  listEvents(tenantId,limit=50){return this.store.listEvents(tenantId,limit);}
  listMatters(tenantId,limit=100){return this.store.listMatters(tenantId,limit);}
  audits(tenantId){return this.store.listAudits(tenantId);}
}
