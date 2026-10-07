import {normalizeReviewRequest, reviewScope, reviewFingerprint} from './reviewRequest.js';
import {inboundEventView, requestInboundRecovery} from './inboundRecovery.js';
import {normalizeInboundInput, inboundFingerprint, ingestScope} from './inboundRequest.js';
import {WritebackWorker, newWritebackCommand, writebackScope} from './writeback.js';
import crypto from 'node:crypto'; import {appError} from './errors.js'; import {inspectFile} from './fileSafety.js'; import {matchMatter} from './matcher.js';
export class Platform {
  constructor({store,objectStorage,aiGateway,proclaim,graph=null}){this.store=store;this.objectStorage=objectStorage;this.aiGateway=aiGateway;this.proclaim=proclaim;this.graph=graph;this.writebackWorker=new WritebackWorker({store,proclaim});}
  #trace(){return `trc_${crypto.randomUUID()}`;}
  ingest({tenantId,input,idempotencyKey}) {
    if (typeof tenantId!=='string'||!tenantId||tenantId.length>200) throw appError('tenant required',{status:401,code:'TENANT_REQUIRED'});
    if (typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>200) throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
    const normalized=normalizeInboundInput(input);
    const fingerprint=inboundFingerprint(normalized);
    return this.store.transaction(() => {
      const scope=ingestScope(tenantId,idempotencyKey);
      const existing=this.store.getIdempotent(scope)||this.store.getIdempotent(`${tenantId}:ingest:${idempotencyKey}`);
      if (existing) {
        if (typeof existing.eventId!=='string'||typeof existing.jobId!=='string') throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
        // Old delimiter-qualified scopes can collide. Verify ownership before replay.
        const event=this.store.getEvent(tenantId,existing.eventId);
        const job=this.store.getJob(existing.jobId);
        if (!event||!job||job.tenantId!==tenantId||job.type!=='PROCESS_INBOUND'||job.payload?.eventId!==event.id) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
        let original=event.ingestFingerprint;
        if (!original) {
          // Older attachment records lack the original MIME/byte fingerprint.
          if (!Array.isArray(event.attachments)||event.attachments.length) throw appError('original request cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
          original=inboundFingerprint(normalizeInboundInput({sourceSystem:event.sourceSystem,externalEventId:event.externalEventId,subject:event.subject,body:event.body}));
        }
        if (original!==fingerprint) throw appError('idempotency key conflicts with prior request',{status:409,code:'IDEMPOTENCY_CONFLICT'});
        if (!event.ingestFingerprint) {event.ingestFingerprint=original;this.store.updateEvent(event);}
        const result={eventId:event.id,jobId:job.id,traceId:event.traceId,status:'QUEUED',replayed:false};
        this.store.setIdempotent(scope,result);
        return {...result,replayed:true};
      }
      const traceId=this.#trace(),eventId=this.store.uid('evt'),attachments=[];
      for (const attachment of normalized.attachments) {
        const safety=inspectFile({filename:attachment.filename,bytes:attachment.bytes});
        let objectRef=null;
        if (safety.verdict==='SAFE_FOR_PARSER') objectRef=this.objectStorage.put({tenantId,bytes:attachment.bytes,contentType:attachment.contentType,metadata:{filename:attachment.filename}}).objectRef;
        attachments.push({filename:attachment.filename,safety,objectRef});
      }
      const event={id:eventId,tenantId,traceId,status:'QUEUED',sourceSystem:normalized.sourceSystem,
        externalEventId:normalized.externalEventId,subject:normalized.subject,body:normalized.body,attachments,ingestFingerprint:fingerprint};
      this.store.putEvent(event);
      const job=this.store.enqueue({tenantId,type:'PROCESS_INBOUND',payload:{eventId},traceId});
      const result={eventId,jobId:job.id,traceId,status:'QUEUED',replayed:false};
      this.store.setIdempotent(scope,result);
      this.store.audit({tenantId,traceId,action:'INBOUND_ACCEPTED',objectId:eventId,outcome:'SUCCESS'});
      return result;
    });
  }
  async processNext({tenantId=null,eventId=null}={}) {
    const job = this.store.claimNext('PROCESS_INBOUND',tenantId,{eventId});
    if (!job) return null;
    try {
      const result = await this.#processInbound(job);
      return {jobId:job.id,status:'DONE',result};
    } catch {
      if (this.store.getJob(job.id)?.status==='CANCELLED') return {jobId:job.id,status:'SUPERSEDED',eventId:job.payload.eventId};
      // Provider/storage errors may contain document text, credentials or paths.
      const code = 'INBOUND_PROCESSING_FAILED';
      this.store.failJob(job.id,code,{retry:job.attempts<3,delayMs:0});
      return {jobId:job.id,status:'FAILED',error:code};
    }
  }
  #finishInbound(job,event,replayed=false) {
    const active=this.store.getJob(job.id);
    if (active?.status!=='RUNNING'||active.attempts!==job.attempts) return {eventId:event.id,status:event.status,superseded:true};
    this.store.completeJob(job.id);
    return {eventId:event.id,status:event.status,match:event.match,
      classification:event.classification,exceptionId:event.processing?.exceptionId||null,replayed};
  }
  async #processInbound(job) {
    const event = this.store.getEvent(job.tenantId,job.payload.eventId);
    if (!event) throw new Error('event unavailable');
    const processedStates = ['REVIEW_REQUIRED','READY_FOR_APPROVAL','APPROVED','REJECTED','COMPLETED',
      'OUTCOME_UNKNOWN','RECONCILING','RECONCILIATION_FAILED','WRITE_FAILED'];
    if (event.status !== 'QUEUED') {
      if (!processedStates.includes(event.status)) throw new Error('invalid inbound state');
      return this.store.transaction(() => this.#finishInbound(job,event,true));
    }
    // External classification is outside the synchronous SQLite transaction.
    const match = matchMatter({tenantId:job.tenantId,subject:event.subject,body:event.body,store:this.store});
    const ai = await this.aiGateway.classifyInbound({authorizedContext:{subject:event.subject,body:event.body}});
    if (!ai || typeof ai !== 'object' || Array.isArray(ai) || !['OK','BLOCKED'].includes(ai.status) || typeof ai.classification !== 'string' || !ai.classification.trim() || !Number.isFinite(ai.confidence) || ai.confidence<0 || ai.confidence>1) throw new Error('invalid classification response');
    const unsafe = event.attachments.filter(a=>a.safety.verdict!=='SAFE_FOR_PARSER');
    const needsReview = unsafe.length>0 || match.decision!=='AUTO' || ai.status!=='OK';
    return this.store.transaction(() => {
      // A competing job may have processed/approved the event while AI was running.
      const current = this.store.getEvent(job.tenantId,event.id);
      if (!current) throw new Error('event unavailable');
      const active=this.store.getJob(job.id);
      if (active?.status!=='RUNNING'||active.attempts!==job.attempts) return {eventId:current.id,status:current.status,superseded:true};
      if (current.status !== 'QUEUED') {
        if (!processedStates.includes(current.status)) throw new Error('invalid inbound state');
        return this.#finishInbound(job,current,true);
      }
      let exceptionId = null;
      if (needsReview) {
        const exception = {id:this.store.uid('exc'),tenantId:job.tenantId,eventId:event.id,status:'OPEN',
          type:unsafe.length?'FILE_SAFETY':ai.status!=='OK'?'AI_SAFETY':'MATTER_MATCH',
          reason:unsafe.length?unsafe.map(x=>x.safety.reason).join(','):ai.status!=='OK'?ai.reason:match.reason,
          candidates:match.candidates||[]};
        this.store.putException(exception);
        exceptionId = exception.id;
      }
      current.match=match;current.classification=ai;
      current.status=needsReview?'REVIEW_REQUIRED':'READY_FOR_APPROVAL';
      current.processing={...current.processing,state:'COMPLETED',exceptionId};
      this.store.updateEvent(current);
      this.store.audit({tenantId:job.tenantId,traceId:current.traceId,action:'INBOUND_PROCESSED',objectId:current.id,
        matterId:match.matterId||null,outcome:needsReview?'REVIEW':'READY',reason:exceptionId||'policy_ready'});
      return this.#finishInbound(job,current);
    });
  }
  getMatter(tenantId,matterId){return this.store.getMatter(tenantId,matterId);}
  listExceptions(tenantId){return this.store.listExceptions(tenantId,'OPEN');}
  resolveException({tenantId,exceptionId,resolution,matterId=null,notes=null,actorId='synthetic-reviewer',idempotencyKey}) {
    const request=normalizeReviewRequest({resolution,matterId,notes,actorId,idempotencyKey});
    ({matterId,notes}=request);
    const fingerprint=reviewFingerprint(request);
    return this.store.transaction(() => {
      const ex = this.store.getException(tenantId,exceptionId);
      if (!ex) throw appError('exception unavailable', {status:404,code:'NOT_FOUND'});
      const event = this.store.getEvent(tenantId,ex.eventId);
      if (!event) throw appError('event unavailable', {status:404,code:'NOT_FOUND'});
      const scope=reviewScope(tenantId,idempotencyKey);
      const previous=this.store.getIdempotent(scope)||this.store.getIdempotent(`${tenantId}:exception-resolve:${idempotencyKey}`);
      if (previous) {
        const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
        const changed=()=>appError('idempotency key conflicts with prior decision',{status:409,code:'IDEMPOTENCY_CONFLICT'});
        if (previous.exceptionId!==exceptionId) throw changed();
        if (previous.eventId!==event.id||ex.status!=='RESOLVED') throw unavailable();
        const recorded=ex.resolution==='APPROVED'?'APPROVE':ex.resolution==='REJECTED'?'REJECT':null;
        if (!recorded||previous.resolution!==recorded||ex.resolvedBy!== (recorded==='APPROVE'?event.approvedBy:event.rejectedBy)) throw unavailable();
        if (previous.requestFingerprint) {
          if (previous.requestFingerprint!==fingerprint) throw changed();
        } else {
          // Historical approval notes were not stored: nonempty notes cannot be verified.
          if (recorded==='APPROVE'&&notes!==null) throw appError('original review request cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
          if (resolution!==recorded||actorId!==ex.resolvedBy||notes!==(ex.notes??null)||
              (recorded==='APPROVE'?(matterId??event.match?.matterId)!==ex.matterId:matterId!==null)) throw changed();
        }
        if (resolution!==recorded||actorId!==ex.resolvedBy||notes!==(ex.notes??null)) throw changed();
        let out={exceptionId,eventId:event.id,resolution:recorded,status:'RESOLVED',replayed:false};
        if (recorded==='APPROVE') {
          const job=this.store.getJob(previous.jobId);
          if (previous.matterId!==ex.matterId||event.approvedMatterId!==ex.matterId||!this.store.getMatter(tenantId,ex.matterId)||
              !job||job.tenantId!==tenantId||job.type!=='PROCLAIM_WRITEBACK'||job.payload?.eventId!==event.id||job.payload?.matterId!==ex.matterId||job.payload?.approvalKey!==event.writeback?.commandKey) throw unavailable();
          out={...out,matterId:ex.matterId,jobId:job.id};
        } else if (event.status!=='REJECTED'||event.rejectionNotes!==notes) throw unavailable();
        this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
        return {...out,replayed:true};
      }
      if (ex.status !== 'OPEN' || event.status !== 'REVIEW_REQUIRED') throw appError('review decision already recorded', {status:409,code:'INVALID_REVIEW_STATE'});
      if (resolution === 'APPROVE') {
        ex.notes=notes;this.store.updateException(ex);
        const result = this.approve({tenantId,eventId:event.id,matterId,exceptionId,actorId,idempotencyKey:`resolve:${idempotencyKey}`});
        const out = {exceptionId,eventId:event.id,resolution:'APPROVE',status:'RESOLVED',matterId:result.matterId,jobId:result.jobId,replayed:false};
        this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
        return out;
      }
      ex.status='RESOLVED';ex.resolution='REJECTED';ex.resolvedBy=actorId;ex.notes=notes;
      this.store.updateException(ex);
      event.status='REJECTED';event.rejectedBy=actorId;event.rejectionNotes=notes;
      this.store.updateEvent(event);
      this.store.audit({tenantId,traceId:event.traceId,action:'INBOUND_REJECTED',objectId:event.id,actorId,outcome:'SUCCESS',reason:notes||'human_rejection'});
      const out = {exceptionId,eventId:event.id,resolution:'REJECT',status:'RESOLVED',replayed:false};
      this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
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
  requestInboundRecovery(input){return requestInboundRecovery(this.store,input);}
  getEvent(tenantId,eventId){return inboundEventView(this.store,this.store.getEvent(tenantId,eventId));}
  listEvents(tenantId,limit=50){return this.store.listEvents(tenantId,limit).map(event=>inboundEventView(this.store,event));}
  listMatters(tenantId,limit=100){return this.store.listMatters(tenantId,limit);}
  audits(tenantId){return this.store.listAudits(tenantId);}
}
