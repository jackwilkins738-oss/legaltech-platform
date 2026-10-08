import {boundInboundJob,hasInboundDecisionEvidence,activeInboundCycle} from './inboundJobEvidence.js';
import {assertReviewIdentity,assertUndecidedEvent,assertOpenReview,assertRejectedReview,commitReviewEvent,commitReviewException,reviewAuditView} from './reviewEvidence.js';
import {sourceFingerprint,processingFingerprint,assertProcessingEvidence} from './processingEvidence.js';
import {normalizeClassificationResult} from './aiGateway.js';
import {normalizeApprovalRequest,approvalScope,approvalFingerprint,replayApproval} from './approvalRequest.js';
import {normalizeReviewRequest, reviewScope, reviewFingerprint} from './reviewRequest.js';
import {inboundEventView, requestInboundRecovery} from './inboundRecovery.js';
import {normalizeInboundInput, inboundFingerprint, ingestScope} from './inboundRequest.js';
import {WritebackWorker, newWritebackCommand, writebackScope} from './writeback.js';
import crypto from 'node:crypto'; import {appError} from './errors.js'; import {inspectFile,basicIngestAccepted} from './fileSafety.js'; import {matchMatter} from './matcher.js';
class SupersededInbound extends Error {}
class InvalidInboundEvidence extends Error {}
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
        if (basicIngestAccepted(safety.verdict)) objectRef=this.objectStorage.put({tenantId,bytes:attachment.bytes,contentType:attachment.contentType,metadata:{filename:attachment.filename}}).objectRef;
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
    } catch (error) {
      if(error instanceof SupersededInbound||!this.#currentInboundClaim(job)) return this.#supersededInbound(job);
      // Provider/storage errors may contain document text, credentials or paths.
      const code = 'INBOUND_PROCESSING_FAILED';
      if(!this.store.failClaimedJob(job,code,{retry:!(error instanceof InvalidInboundEvidence)&&Number.isSafeInteger(job.attempts)&&job.attempts>=1&&job.attempts<3,delayMs:0})) return this.#supersededInbound(job);
      return {jobId:job.id,status:'FAILED',error:code};
    }
  }
  #currentInboundClaim(job) {
    if(!this.store.isCurrentClaim(job))return false;
    const latest=this.store.getJob(job.id);
    return boundInboundJob(latest,{id:job.payload?.eventId,tenantId:job.tenantId,traceId:job.traceId})&&latest.traceId===job.traceId&&JSON.stringify(latest.payload)===JSON.stringify(job.payload);
  }
  #supersededInbound(job) {
    const eventId=job.payload?.eventId;
    return {jobId:job.id,status:'SUPERSEDED',eventId,result:{eventId,superseded:true}};
  }
  #assertInbound(job,event) {
    if(!this.#currentInboundClaim(job))throw new SupersededInbound();
    if(!boundInboundJob(job,event)||job.attempts<1||job.attempts>3||(event.status==='QUEUED'&&hasInboundDecisionEvidence(event)))throw new InvalidInboundEvidence('inbound binding unavailable');
    if(event.status==='QUEUED'){let valid=false;try{valid=activeInboundCycle(this.store,job,event);}catch{}if(!valid)throw new InvalidInboundEvidence('inbound cycle unavailable');}
  }
  #finishInbound(job,event,replayed=false) {
    this.#assertInbound(job,event);
    if(!this.store.completeClaimedJob(job))throw new SupersededInbound();
    return {eventId:event.id,status:event.status,match:event.match,
      classification:event.classification,exceptionId:event.processing?.exceptionId||null,replayed};
  }
  #verifyAttachments(event) {
    if(!Array.isArray(event.attachments))throw new Error('attachment state unavailable');
    for(const attachment of event.attachments) {
      if(!attachment||!(basicIngestAccepted(attachment.safety?.verdict)||attachment.safety?.verdict==='QUARANTINE'))throw new Error('attachment state unavailable');
      if(attachment.safety.verdict==='QUARANTINE')continue;
      // The durable safety label is insufficient if the owned object is unavailable.
      const bytes=this.objectStorage.get({tenantId:event.tenantId,objectRef:attachment.objectRef});
      if(!Buffer.isBuffer(bytes)||!basicIngestAccepted(inspectFile({filename:attachment.filename,bytes}).verdict))throw new Error('attachment unavailable');
    }
  }
  async #processInbound(job) {
    const event = this.store.getEvent(job.tenantId,job.payload.eventId);
    this.#assertInbound(job,event);
    const processedStates = ['REVIEW_REQUIRED','READY_FOR_APPROVAL','APPROVED','REJECTED','COMPLETED',
      'OUTCOME_UNKNOWN','RECONCILING','RECONCILIATION_FAILED','WRITE_FAILED'];
    if (event.status !== 'QUEUED') {
      if (!processedStates.includes(event.status)) throw new Error('invalid inbound state');
      return this.store.transaction(() => this.#finishInbound(job,event,true));
    }
    const source=normalizeInboundInput({sourceSystem:event.sourceSystem,externalEventId:event.externalEventId,subject:event.subject,body:event.body});
    this.#verifyAttachments(event);
    // External classification is outside the synchronous SQLite transaction.
    const fingerprint=sourceFingerprint(event);
    const response = await this.aiGateway.classifyInbound({authorizedContext:{subject:source.subject,body:source.body}});
    return this.store.transaction(() => {
      // A competing job may have processed/approved the event while AI was running.
      const current = this.store.getEvent(job.tenantId,event.id);
      this.#assertInbound(job,current);
      if (current.status !== 'QUEUED') {
        if (!processedStates.includes(current.status)) throw new Error('invalid inbound state');
        return this.#finishInbound(job,current,true);
      }
      if(sourceFingerprint(current)!==fingerprint)throw new Error('inbound source changed');
      // Current owned matter evidence and bytes must still support this source.
      this.#verifyAttachments(current);
      const ai=normalizeClassificationResult(response);
      const match=matchMatter({tenantId:job.tenantId,subject:current.subject,body:current.body,store:this.store});
      const unsafe=current.attachments.filter(a=>!basicIngestAccepted(a.safety.verdict));
      const needsReview=unsafe.length>0||match.decision!=='AUTO'||ai.status!=='OK';
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
      current.processing={...current.processing,state:'COMPLETED',exceptionId,evidenceVersion:'v51',evidenceFingerprint:processingFingerprint(current)};
      this.store.updateEvent(current);
      this.store.audit({tenantId:job.tenantId,traceId:current.traceId,action:'INBOUND_PROCESSED',objectId:current.id,
        matterId:match.matterId||null,outcome:needsReview?'REVIEW':'READY',reason:exceptionId||'policy_ready'});
      return this.#finishInbound(job,current);
    });
  }
  getMatter(tenantId,matterId){return this.store.getMatter(tenantId,matterId);}
  listExceptions(tenantId,limit=100){return this.store.listExceptions(tenantId,'OPEN',limit);}
  getException(tenantId,exceptionId){return this.store.getException(tenantId,exceptionId);}
  resolveException({tenantId,exceptionId,resolution,matterId=null,notes=null,actorId='synthetic-reviewer',idempotencyKey}) {
    const request=normalizeReviewRequest({resolution,matterId,notes,actorId,idempotencyKey});
    ({matterId,notes}=request);
    const fingerprint=reviewFingerprint(request);
    return this.store.transaction(() => {
      const ex = this.store.getException(tenantId,exceptionId);
      if (!ex) throw appError('exception unavailable', {status:404,code:'NOT_FOUND'});
      const event = this.store.getEvent(tenantId,ex.eventId);
      if (!event) throw appError('event unavailable', {status:404,code:'NOT_FOUND'});
      assertReviewIdentity({tenantId,exceptionId,event,exception:ex});
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
          const approvalKey=`resolve:${idempotencyKey}`;
          if(event.writeback?.commandKey!==approvalKey||(!this.store.getIdempotent(approvalScope(tenantId,approvalKey))&&!this.store.getIdempotent(`${tenantId}:approve:${approvalKey}`)))throw unavailable();
          const approval=this.approve({tenantId,eventId:event.id,matterId:ex.matterId,exceptionId,actorId,idempotencyKey:approvalKey});
          if(approval.jobId!==job.id)throw unavailable();
          out={...out,matterId:ex.matterId,jobId:job.id};
        } else assertRejectedReview(this.store,{tenantId,event,exception:ex,notes});
        this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
        return {...out,replayed:true};
      }
      if (ex.status !== 'OPEN' || event.status !== 'REVIEW_REQUIRED') throw appError('review decision already recorded', {status:409,code:'INVALID_REVIEW_STATE'});
      assertUndecidedEvent(event);
      assertOpenReview(this.store,{tenantId,event,exception:ex});
      const originalEvent=structuredClone(event),originalException=structuredClone(ex);
      if (resolution === 'APPROVE') {
        ex.notes=notes;commitReviewException(this.store,ex,originalException);
        const result = this.approve({tenantId,eventId:event.id,matterId,exceptionId,actorId,idempotencyKey:`resolve:${idempotencyKey}`});
        const out = {exceptionId,eventId:event.id,resolution:'APPROVE',status:'RESOLVED',matterId:result.matterId,jobId:result.jobId,replayed:false};
        this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
        return out;
      }
      ex.status='RESOLVED';ex.resolution='REJECTED';ex.resolvedBy=actorId;ex.notes=notes;
      commitReviewException(this.store,ex,originalException);
      event.status='REJECTED';event.rejectedBy=actorId;event.rejectedExceptionId=ex.id;event.rejectionNotes=notes;
      commitReviewEvent(this.store,event,originalEvent);
      this.store.audit({tenantId,traceId:event.traceId,action:'INBOUND_REJECTED',objectId:event.id,actorId,outcome:'SUCCESS',reason:'human_rejection'});
      const out = {exceptionId,eventId:event.id,resolution:'REJECT',status:'RESOLVED',replayed:false};
      this.store.setIdempotent(scope,{...out,requestFingerprint:fingerprint});
      return out;
    });
  }
  approve({tenantId,eventId,matterId=null,exceptionId=null,actorId='synthetic-reviewer',idempotencyKey}) {
    const request=normalizeApprovalRequest({matterId,exceptionId,actorId,idempotencyKey});
    ({matterId,exceptionId}=request);
    return this.store.transaction(() => {
      const event = this.store.getEvent(tenantId,eventId);
      if (!event) throw appError('event unavailable', {status:404,code:'NOT_FOUND'});
      const scope=approvalScope(tenantId,idempotencyKey);
      const previous=this.store.getIdempotent(scope)||this.store.getIdempotent(`${tenantId}:approve:${idempotencyKey}`);
      if (previous) {
        return replayApproval(this.store,{tenantId,event,request,previous});
      }
      if (!['READY_FOR_APPROVAL','REVIEW_REQUIRED'].includes(event.status)) throw appError('event cannot be approved again', {status:409,code:'INVALID_REVIEW_STATE'});
      if(event.id!==eventId||event.tenantId!==tenantId)throw appError('event unavailable',{status:404,code:'NOT_FOUND'});
      assertUndecidedEvent(event);
      const originalEvent=structuredClone(event);
      if(this.store.getIdempotent(writebackScope(tenantId,idempotencyKey)))throw appError('idempotency key conflicts with prior decision',{status:409,code:'IDEMPOTENCY_CONFLICT'});
      const resolvedMatterId = matterId ?? event.match?.matterId;
      const matter = this.store.getMatter(tenantId,resolvedMatterId);
      if (!resolvedMatterId || !matter || matter.id!==resolvedMatterId || matter.tenantId!==tenantId) throw appError('matter unavailable', {status:404,code:'NOT_FOUND'});
      if(event.status==='REVIEW_REQUIRED'&&exceptionId===null)throw appError('open exception decision required',{status:409,code:'INVALID_REVIEW_STATE'});
      try {this.#verifyAttachments(event);}catch {throw appError('attachment evidence unavailable',{status:409,code:'ATTACHMENT_UNAVAILABLE'});}
      try {assertProcessingEvidence(event);}catch {throw appError('classification evidence unavailable',{status:409,code:'CLASSIFICATION_UNAVAILABLE'});}
      if (exceptionId) {
        const ex = this.store.getException(tenantId,exceptionId);
        if (!ex || ex.eventId !== eventId) throw appError('exception unavailable', {status:404,code:'NOT_FOUND'});
        assertReviewIdentity({tenantId,exceptionId,event,exception:ex});
        assertOpenReview(this.store,{tenantId,event,exception:ex});
        const originalException=structuredClone(ex);
        ex.status='RESOLVED';ex.resolution='APPROVED';ex.matterId=resolvedMatterId;ex.resolvedBy=actorId;
        commitReviewException(this.store,ex,originalException);
      }
      event.status='APPROVED';event.approvedMatterId=resolvedMatterId;event.approvedBy=actorId;event.approvedExceptionId=exceptionId;
      const job = this.store.enqueue({tenantId,type:'PROCLAIM_WRITEBACK',payload:{eventId,matterId:resolvedMatterId,approvalKey:idempotencyKey},traceId:event.traceId});
      const command = newWritebackCommand({tenantId,event,matter,key:idempotencyKey,jobId:job.id});
      this.store.setIdempotent(writebackScope(tenantId,idempotencyKey),command);
      event.writeback = {state:'PENDING',commandKey:idempotencyKey,verified:false,writeAttempts:0,reconciliationAttempts:0,totalReadAttempts:0,recoveryCount:0};
      commitReviewEvent(this.store,event,originalEvent);
      const result = {eventId,jobId:job.id,status:'APPROVED',matterId:resolvedMatterId,replayed:false};
      this.store.setIdempotent(scope,{...result,requestFingerprint:approvalFingerprint(resolvedMatterId,exceptionId,actorId)});
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
  audits(tenantId,limit=100){return this.store.listAudits(tenantId,limit).map(reviewAuditView);}
}
