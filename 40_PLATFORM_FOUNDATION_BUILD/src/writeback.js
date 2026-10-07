import {assertProcessingEvidence} from './processingEvidence.js';
import crypto from 'node:crypto';
import {appError} from './errors.js';
import {KnownWriteFailure} from './adapters.js';

export const writebackScope = (tenantId, key) => JSON.stringify([tenantId, 'writeback', key]);
const requestScope = (tenantId, key) => JSON.stringify([tenantId, 'reconcile-writeback', key]);
const unavailable = () => appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
const conflict = () => appError('writeback state does not permit this action', {status: 409, code: 'INVALID_WRITEBACK_STATE'});
const validId = (value,max=200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const states=['PENDING','ATTEMPTING','FAILED_KNOWN','SUCCEEDED','OUTCOME_UNKNOWN','RECONCILING','RECONCILED'];
const eventStates=['APPROVED','COMPLETED','OUTCOME_UNKNOWN','RECONCILING','RECONCILIATION_FAILED','WRITE_FAILED'];
const counters=['writeAttempts','reconciliationAttempts','totalReadAttempts','recoveryCount'];
const sameBinding=(a,b)=>['tenantId','eventId','matterId','externalMatterId','key','actorId','classification','traceId'].every(field=>a[field]===b[field]);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requestFingerprint=(command,actorId,idempotencyKey)=>digest([idempotencyKey,command.tenantId,command.eventId,command.matterId,command.externalMatterId,command.key,command.actorId,command.classification,command.traceId,actorId]);
const receiptFingerprint=(fingerprint,result)=>digest([fingerprint,result.eventId,result.jobId,result.status,result.readOnly]);
const errorCodes=['RATE_LIMITED','AUTH_REVOKED','UNAVAILABLE','INVALID_REQUEST','MOCK_FAILURE','EXTERNAL_WRITE_OUTCOME_UNKNOWN','INVALID_WRITE_RECEIPT','READBACK_UNAVAILABLE','AMBIGUOUS_READBACK','READBACK_NOT_CONFIRMED'];
const safeFailureCode=value=>['RATE_LIMITED','AUTH_REVOKED','UNAVAILABLE','INVALID_REQUEST','MOCK_FAILURE'].includes(value)?value:'MOCK_FAILURE';
class SupersededClaim extends Error {}
class SupersededCycle extends Error {}
const superseded=job=>({jobId:job.id,eventId:job.payload.eventId,status:'SUPERSEDED'});
const view = command => ({state: command.state, externalWriteId: command.externalWriteId || null, verified: command.state === 'RECONCILED', writeAttempts: command.writeAttempts, reconciliationAttempts: command.reconciliationAttempts, totalReadAttempts: command.totalReadAttempts, recoveryCount: command.recoveryCount, errorCode: command.errorCode || null});

export function newWritebackCommand({tenantId, event, matter, key, jobId}) {
  return {tenantId, eventId: event.id, matterId: matter.id, externalMatterId: matter.externalId, key, jobId, traceId: event.traceId, actorId: event.approvedBy, classification: event.classification?.classification || 'UNKNOWN', state: 'PENDING', writeAttempts: 0, reconciliationAttempts: 0, totalReadAttempts: 0, recoveryCount: 0, externalWriteId: null, uncertain: false, retryable: false, errorCode: null};
}

// Synthetic adapter contract: durable intent before I/O; uncertainty never permits another write.
export class WritebackWorker {
  constructor({store, proclaim, maxWrites = 3, maxReads = 3}) {
    if (![maxWrites,maxReads].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=100)) throw new Error('invalid worker budget');
    Object.assign(this, {store, proclaim, maxWrites, maxReads});
  }
  #assertClaim(job) {
    if (!this.store.isCurrentClaim(job)) throw new SupersededClaim();
    const latest=this.store.getJob(job.id);
    if (latest.traceId!==job.traceId||['eventId','matterId','approvalKey'].some(field=>latest.payload?.[field]!==job.payload?.[field])) throw conflict();
  }
  #validate(command,event,matter) {
    if (!record(command)||!['tenantId','eventId','matterId','jobId'].every(field=>validId(command[field]))||!event||!matter||!eventStates.includes(event.status)||
        matter.tenantId!==event.tenantId||command.tenantId!==event.tenantId||command.eventId!==event.id||command.matterId!==matter.id||event.approvedMatterId!==matter.id||
        command.externalMatterId!==matter.externalId||!validId(matter.externalId,512)||!validId(command.key,208)||
        (event.writeback?.commandKey!==undefined&&event.writeback.commandKey!==command.key)||command.actorId!==event.approvedBy||!validId(event.approvedBy)||
        command.traceId!==event.traceId||!validId(event.traceId)||command.classification!==(event.classification?.classification||'UNKNOWN')||
        !states.includes(command.state)||typeof command.uncertain!=='boolean'||typeof command.retryable!=='boolean'||
        !counters.every(field=>Number.isSafeInteger(command[field])&&command[field]>=0)||command.totalReadAttempts<command.reconciliationAttempts||
        (command.externalWriteId!==null&&!validId(command.externalWriteId))||
        (command.errorCode!==null&&!errorCodes.includes(command.errorCode))||
        (command.state==='RECONCILED'&&(!validId(command.externalWriteId)||command.uncertain))) throw conflict();
    try {assertProcessingEvidence(event);}catch {throw conflict();}
    return command;
  }
  #current(command) {
    if (!record(command)||!['tenantId','eventId','matterId','jobId'].every(field=>validId(command[field]))) throw conflict();
    return this.#validate(command,this.store.getEvent(command.tenantId,command.eventId),this.store.getMatter(command.tenantId,command.matterId));
  }
  #load(job) {
    this.#assertClaim(job);
    const {eventId, matterId, approvalKey} = job.payload;
    const event = this.store.getEvent(job.tenantId, eventId);
    const matter = this.store.getMatter(job.tenantId, matterId);
    if (!event||!matter||!validId(approvalKey,208)||job.traceId!==event.traceId) throw conflict();
    const scope = writebackScope(job.tenantId, approvalKey);
    let command = this.store.getIdempotent(scope);
    if (!command) {
      // Missing command evidence never erases an event's recorded write attempt.
      command = newWritebackCommand({tenantId: job.tenantId, event, matter, key: approvalKey, jobId: job.id});
      const receipt = event.writeback;
      if (record(receipt)&&validId(receipt.externalWriteId)) {
        command.externalWriteId = receipt.externalWriteId;
        // A legacy completion flag is not read-back evidence. Verify it again.
        command.state = 'SUCCEEDED';
      } else if (job.attempts > 1 || job.payload.reconcileOnly || event.status!=='APPROVED'||
          receipt&&(receipt.state!=='PENDING'||receipt.writeAttempts!==0||receipt.verified===true)) {
        command.state = 'OUTCOME_UNKNOWN';
        command.uncertain = true;
      }
      // Preserve finite lifetime history where it can be proved from the event.
      for (const field of counters) if (Number.isSafeInteger(receipt?.[field])&&receipt[field]>=0) command[field]=receipt[field];
      command.totalReadAttempts=Math.max(command.totalReadAttempts,command.reconciliationAttempts);
      this.#validate(command,event,matter);
      command=this.#persist(command,null,job);
    }
    if (command.key!==approvalKey) throw conflict();
    return this.#validate(command,event,matter);
  }
  #record(command,audit=null) {
    this.#current(command);
    const event=this.store.getEvent(command.tenantId,command.eventId);
    command.updatedAt=new Date().toISOString();
    this.store.setIdempotent(writebackScope(command.tenantId,command.key),command);
    const exhausted=command.reconciliationAttempts>=this.maxReads;
    event.status=command.state==='RECONCILED'?'COMPLETED'
      :command.state==='FAILED_KNOWN'&&(!command.retryable||command.writeAttempts>=this.maxWrites)?'WRITE_FAILED'
      :command.uncertain?'OUTCOME_UNKNOWN'
      :['SUCCEEDED','RECONCILING'].includes(command.state)?(exhausted?'RECONCILIATION_FAILED':'RECONCILING'):'APPROVED';
    event.writeback={...view(command),commandKey:command.key};
    this.store.updateEvent(event);
    if (audit) this.store.audit({tenantId:command.tenantId,traceId:command.traceId,actorId:command.actorId,matterId:command.matterId,objectId:command.eventId,...audit});
    return structuredClone(command);
  }
  #persist(command,audit=null,job=null) {
    let oldCycle=false;
    const result=this.store.transaction(()=>{
      if (job) this.#assertClaim(job);
      const current=this.store.getIdempotent(writebackScope(command.tenantId,command.key));
      this.#current(command);
      if (current) {this.#current(current);if (!sameBinding(current,command)) throw conflict();}
      if (job&&current&&command.recoveryCount<current.recoveryCount) {
        oldCycle=true;
        // Old failures cannot consume/reset the new cycle. Retain only bound positive evidence.
        if (current.state==='RECONCILED') return current;
        const receipt=validId(command.externalWriteId)&&(!current.externalWriteId||current.externalWriteId===command.externalWriteId);
        if (receipt&&command.state==='RECONCILED') {
          const next={...current,externalWriteId:command.externalWriteId,state:'RECONCILED',uncertain:false,errorCode:null};
          return this.#record(next,{action:'PROCLAIM_WRITE_RECONCILED',outcome:'SUCCESS',reason:'LATE_CYCLE_READBACK'});
        }
        if (receipt&&command.state==='SUCCEEDED'&&!current.externalWriteId) {
          const next={...current,externalWriteId:command.externalWriteId,uncertain:false,
            errorCode:current.errorCode==='EXTERNAL_WRITE_OUTCOME_UNKNOWN'?null:current.errorCode,
            state:current.state==='RECONCILING'?'RECONCILING':'SUCCEEDED'};
          return this.#record(next,{action:'PROCLAIM_LATE_RECEIPT_CAPTURED',outcome:'UNVERIFIED'});
        }
        return current;
      }
      if (current?.state==='RECONCILED') return current;
      if (current?.externalWriteId&&command.externalWriteId&&current.externalWriteId!==command.externalWriteId) throw conflict();
      if (current) {
        command.writeAttempts=Math.max(command.writeAttempts,current.writeAttempts);
        command.totalReadAttempts=Math.max(command.totalReadAttempts,current.totalReadAttempts);
        if (command.recoveryCount===current.recoveryCount) command.reconciliationAttempts=Math.max(command.reconciliationAttempts,current.reconciliationAttempts);
        if (command.recoveryCount<current.recoveryCount) return current;
      }
      return this.#record(command,audit);
    });
    if (oldCycle) throw new SupersededCycle();
    return result;
  }
  #reserveRead(job,command) {
    return this.store.transaction(()=>{
      this.#assertClaim(job);
      const latest=this.store.getIdempotent(writebackScope(job.tenantId,command.key));
      if (!latest||!sameBinding(latest,command)) throw conflict();
      this.#current(latest);
      if (command.recoveryCount<latest.recoveryCount) throw new SupersededCycle();
      if (latest.state==='RECONCILED'||latest.reconciliationAttempts>=this.maxReads) return {command:latest,reserved:false};
      if (latest.totalReadAttempts>=Number.MAX_SAFE_INTEGER) throw conflict();
      latest.state='RECONCILING';latest.reconciliationAttempts+=1;latest.totalReadAttempts+=1;
      return {command:this.#persist(latest,null,job),reserved:true};
    });
  }
  #finish(job, command) {
    this.#assertClaim(job);
    if (!this.store.completeClaimedJob(job)) throw new SupersededClaim();
    return {jobId: job.id, eventId: command.eventId, status: 'DONE', result: view(command)};
  }
  #wait(job, command, retry) {
    this.#assertClaim(job);
    if (!this.store.failClaimedJob(job,command.errorCode || 'WRITEBACK_UNVERIFIED',{retry})) throw new SupersededClaim();
    return {jobId: job.id, eventId: command.eventId, status: 'FAILED', error: command.errorCode || 'WRITEBACK_UNVERIFIED', result: view(command)};
  }
  async processNext({tenantId = null, eventId = null} = {}) {
    this.store.recoverExpiredWritebackJobs({tenantId, eventId});
    const job = this.store.claimNext('PROCLAIM_WRITEBACK', tenantId, {eventId});
    if (!job) return null;
    try {
      let command = this.#load(job);
      if (command.state === 'RECONCILED') return this.#finish(job, command);
      const attempt = this.store.transaction(() => {
        this.#assertClaim(job);
        const latest = this.store.getIdempotent(writebackScope(job.tenantId, command.key));
        this.#current(latest);
        if (!sameBinding(latest,command)) throw conflict();
        const mayWrite = this.store.getEvent(job.tenantId,latest.eventId)?.status==='APPROVED' && !latest.uncertain && latest.externalWriteId===null && !job.payload.reconcileOnly && (latest.state === 'PENDING' && latest.writeAttempts===0 || latest.state === 'FAILED_KNOWN' && latest.retryable) && latest.writeAttempts < this.maxWrites;
        if (!mayWrite) return {command: latest, write: false};
        latest.state = 'ATTEMPTING';
        latest.writeAttempts += 1;
        latest.retryable = false;
        latest.errorCode = null;
        return {command: this.#persist(latest, {action: 'PROCLAIM_WRITE_ATTEMPTED', outcome: 'ATTEMPT'}, job), write: true};
      });
      command = attempt.command;
      if (attempt.write) {
        let receipt;
        try {
          receipt = await this.proclaim.createHistory({tenantId: command.tenantId, externalMatterId: command.externalMatterId, idempotencyKey: command.key, payload: {sourceEventId: command.eventId, classification: command.classification}});
        } catch (error) {
          if (error instanceof KnownWriteFailure) {
            command.state = 'FAILED_KNOWN';
            command.retryable = error.retryable === true;
            command.errorCode = safeFailureCode(error.code);
            command = this.#persist(command, {action: 'PROCLAIM_WRITE_FAILED_KNOWN', outcome: 'FAILED', reason: command.errorCode}, job);
            if (command.state === 'RECONCILED') return this.#finish(job, command);
            return this.#wait(job, command, command.retryable && command.writeAttempts < this.maxWrites);
          }
          command.state = 'OUTCOME_UNKNOWN';
          command.uncertain = true;
          command.errorCode = 'EXTERNAL_WRITE_OUTCOME_UNKNOWN';
          command = this.#persist(command, {action: 'PROCLAIM_WRITE_UNCERTAIN', outcome: 'UNKNOWN', reason: command.errorCode}, job);
        }
        if (receipt !== undefined) {
          if (record(receipt)&&validId(receipt.externalWriteId)) {
            command.externalWriteId = receipt.externalWriteId;
            command.state = 'SUCCEEDED';
          } else {
            command.state = 'OUTCOME_UNKNOWN';
            command.uncertain = true;
            command.errorCode = 'INVALID_WRITE_RECEIPT';
          }
          command = this.#persist(command,null,job);
        } else if (command.state === 'ATTEMPTING') {
          command.state = 'OUTCOME_UNKNOWN'; command.uncertain = true; command.errorCode = 'INVALID_WRITE_RECEIPT';
          command = this.#persist(command,null,job);
        }
      }
      if (command.state === 'RECONCILED') return this.#finish(job, command);
      if (command.state === 'ATTEMPTING') {
        // A persisted attempt with no receipt may have reached the external service.
        command.state = 'OUTCOME_UNKNOWN'; command.uncertain = true; command.errorCode = 'EXTERNAL_WRITE_OUTCOME_UNKNOWN';
        command = this.#persist(command,null,job);
      }
      if (!['SUCCEEDED', 'OUTCOME_UNKNOWN', 'RECONCILING'].includes(command.state)) return this.#wait(job, command, false);
      if (command.reconciliationAttempts >= this.maxReads) return this.#wait(job, command, false);
      return await this.#reconcile(job, command);
    } catch (error) {
      if (error instanceof SupersededClaim) return superseded(job);
      if (error instanceof SupersededCycle) {
        try {this.store.completeClaimedJob(job);return superseded(job);}
        catch {return {jobId:job.id,eventId:job.payload.eventId,status:'FAILED',error:'WRITEBACK_INTERNAL_ERROR'};}
      }
      // Do not return/store adapter error text: it may contain credentials or source content.
      if (!this.store.failClaimedJob(job,'WRITEBACK_INTERNAL_ERROR',{retry:job.attempts<3})) return superseded(job);
      return {jobId: job.id, eventId: job.payload.eventId, status: 'FAILED', error: 'WRITEBACK_INTERNAL_ERROR'};
    }
  }
  async #reconcile(job, command) {
    const reservation=this.#reserveRead(job,command);
    command=reservation.command;
    if (command.state==='RECONCILED') return this.#finish(job,command);
    if (!reservation.reserved) return this.#wait(job,command,false);
    let history;
    try {
      history = await this.proclaim.getHistory({tenantId: command.tenantId, externalMatterId: command.externalMatterId});
      if (!Array.isArray(history)) throw new Error('invalid history contract');
    } catch {
      command.state = command.uncertain ? 'OUTCOME_UNKNOWN' : 'SUCCEEDED';
      command.errorCode = 'READBACK_UNAVAILABLE';
      command = this.#persist(command, {action: 'PROCLAIM_READBACK_PENDING', outcome: 'UNVERIFIED', reason: command.errorCode}, job);
      if (command.state === 'RECONCILED') return this.#finish(job, command);
      return this.#wait(job, command, command.reconciliationAttempts < this.maxReads);
    }
    // This is the normalized synthetic adapter contract, not an assumption about live Proclaim.
    const matches = history.filter(item => record(item)&&record(item.payload)&&item.tenantId === command.tenantId && item.externalMatterId === command.externalMatterId && item.idempotencyKey === command.key && item.payload?.sourceEventId === command.eventId && item.payload?.classification === command.classification && validId(item.id));
    if (matches.length === 1 && (!command.externalWriteId || matches[0].id === command.externalWriteId)) {
      command.externalWriteId = matches[0].id;
      command.state = 'RECONCILED'; command.uncertain = false; command.errorCode = null;
      return this.store.transaction(()=>{
        try {command=this.#persist(command,{action:'PROCLAIM_WRITE_RECONCILED',outcome:'SUCCESS'},job);}
        catch (error) {
          if (!(error instanceof SupersededCycle)) throw error;
          if (!this.store.completeClaimedJob(job)) throw new SupersededClaim();
          return superseded(job);
        }
        return this.#finish(job,command);
      });
    }
    command.state = command.uncertain ? 'OUTCOME_UNKNOWN' : 'SUCCEEDED';
    command.errorCode = matches.length > 1 ? 'AMBIGUOUS_READBACK' : 'READBACK_NOT_CONFIRMED';
    command = this.#persist(command, {action: 'PROCLAIM_READBACK_PENDING', outcome: 'UNVERIFIED', reason: command.errorCode}, job);
    if (command.state === 'RECONCILED') return this.#finish(job, command);
    return this.#wait(job, command, command.reconciliationAttempts < this.maxReads);
  }
  requestReconciliation({tenantId, eventId, actorId, idempotencyKey}) {
    if (!validId(idempotencyKey)||/[\x00-\x1f\x7f]/.test(idempotencyKey)) throw appError('idempotency key required', {code: 'IDEMPOTENCY_REQUIRED'});
    if (!validId(actorId)||/[\x00-\x1f\x7f]/.test(actorId)) throw appError('actor required', {code:'ACTOR_REQUIRED'});
    return this.store.transaction(() => {
      const event = this.store.getEvent(tenantId, eventId);
      if (!event) throw unavailable();
      const command = this.store.getIdempotent(writebackScope(tenantId, event.writeback?.commandKey));
      if (!command || command.tenantId !== tenantId || command.eventId !== eventId || command.key !== event.writeback?.commandKey) throw conflict();
      this.#current(command);
      const fingerprint=requestFingerprint(command,actorId,idempotencyKey);
      const bound=job=>job&&job.tenantId===tenantId&&job.type==='PROCLAIM_WRITEBACK'&&job.payload?.eventId===eventId&&job.payload?.matterId===command.matterId&&job.payload?.approvalKey===command.key&&job.traceId===command.traceId;
      const scope = requestScope(tenantId, idempotencyKey);
      const previous = this.store.getIdempotent(scope);
      if (previous) {
        if (previous.eventId !== eventId) throw conflict();
        if (previous.readOnly!==true||!['QUEUED','COMPLETED'].includes(previous.status)) throw unavailable();
        if (previous.jobId===null) {
          if (previous.status!=='COMPLETED'||command.state!=='RECONCILED') throw unavailable();
        } else if (previous.status!=='QUEUED'||!validId(previous.jobId)||!bound(this.store.getJob(previous.jobId))) throw unavailable();
        if (previous.jobId!==null&&this.store.getJob(previous.jobId)?.payload?.reconcileOnly!==true) throw unavailable();
        if (!previous.requestFingerprint||!previous.actorId||!previous.receiptFingerprint) throw appError('original reconciliation request cannot be verified',{status:409,code:'IDEMPOTENCY_UNVERIFIABLE'});
        if (previous.actorId!==actorId||previous.requestFingerprint!==fingerprint) throw appError('idempotency key conflicts with prior reconciliation',{status:409,code:'IDEMPOTENCY_CONFLICT'});
        if (previous.receiptFingerprint!==receiptFingerprint(fingerprint,previous)) throw unavailable();
        return {eventId,jobId:previous.jobId,status:previous.status,readOnly:true,replayed:true};
      }
      if (!['ATTEMPTING', 'SUCCEEDED', 'OUTCOME_UNKNOWN', 'RECONCILING', 'RECONCILED'].includes(command.state)) throw conflict();
      if (command.state === 'ATTEMPTING') {
        command.state = 'OUTCOME_UNKNOWN'; command.uncertain = true; command.errorCode = 'EXTERNAL_WRITE_OUTCOME_UNKNOWN';
        this.#persist(command);
      }
      let job = this.store.getJob(command.jobId);
      if (job && !bound(job)) throw conflict();
      if (command.state === 'RECONCILED') job = null;
      else {
        // A running original write may need one concurrent read-only probe.
        // Once a read-only probe is queued/running, fresh operator keys reuse it.
        const activeRead=this.store.listEventJobs(tenantId,eventId,'PROCLAIM_WRITEBACK')
          .find(candidate=>bound(candidate)&&candidate.payload.reconcileOnly===true&&['QUEUED','RUNNING'].includes(candidate.status));
        if (activeRead) {
          job=activeRead;
          if (command.jobId!==job.id) {command.jobId=job.id;this.#persist(command);}
        } else if (!job || job.status !== 'QUEUED') {
          command.reconciliationAttempts = 0;
          if (command.recoveryCount>=Number.MAX_SAFE_INTEGER) throw conflict();
          command.recoveryCount += 1;
          job = this.store.enqueue({tenantId, type: 'PROCLAIM_WRITEBACK', payload: {eventId, matterId: command.matterId, approvalKey: command.key, reconcileOnly: true}, traceId: command.traceId});
          command.jobId = job.id;
          this.#persist(command);
        }
      }
      if (job) this.store.makeWritebackJobReadOnly(tenantId, job.id);
      const result = {eventId, jobId: job?.id || null, status: command.state === 'RECONCILED' ? 'COMPLETED' : 'QUEUED', readOnly: true, replayed: false};
      this.store.setIdempotent(scope, {...result,actorId,requestFingerprint:fingerprint,receiptFingerprint:receiptFingerprint(fingerprint,result)});
      this.store.audit({tenantId, actorId, traceId: event.traceId, action: 'PROCLAIM_RECONCILIATION_REQUESTED', objectId: eventId, matterId: command.matterId, outcome: 'READ_ONLY'});
      return result;
    });
  }
}
