import {appError} from './errors.js';
import {KnownWriteFailure} from './adapters.js';

export const writebackScope = (tenantId, key) => JSON.stringify([tenantId, 'writeback', key]);
const requestScope = (tenantId, key) => JSON.stringify([tenantId, 'reconcile-writeback', key]);
const unavailable = () => appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
const conflict = () => appError('writeback state does not permit this action', {status: 409, code: 'INVALID_WRITEBACK_STATE'});
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const view = command => ({state: command.state, externalWriteId: command.externalWriteId || null, verified: command.state === 'RECONCILED', writeAttempts: command.writeAttempts, reconciliationAttempts: command.reconciliationAttempts, totalReadAttempts: command.totalReadAttempts, recoveryCount: command.recoveryCount, errorCode: command.errorCode || null});

export function newWritebackCommand({tenantId, event, matter, key, jobId}) {
  return {tenantId, eventId: event.id, matterId: matter.id, externalMatterId: matter.externalId, key, jobId, traceId: event.traceId, actorId: event.approvedBy, classification: event.classification?.classification || 'UNKNOWN', state: 'PENDING', writeAttempts: 0, reconciliationAttempts: 0, totalReadAttempts: 0, recoveryCount: 0, externalWriteId: null, uncertain: false, retryable: false, errorCode: null};
}

// Synthetic adapter contract: durable intent before I/O; uncertainty never permits another write.
export class WritebackWorker {
  constructor({store, proclaim, maxWrites = 3, maxReads = 3}) {
    Object.assign(this, {store, proclaim, maxWrites, maxReads});
  }
  #load(job) {
    const {eventId, matterId, approvalKey} = job.payload;
    const event = this.store.getEvent(job.tenantId, eventId);
    const matter = this.store.getMatter(job.tenantId, matterId);
    if (!event || !matter || !approvalKey || event.approvedMatterId !== matterId || !event.approvedBy || !['APPROVED', 'COMPLETED', 'OUTCOME_UNKNOWN', 'RECONCILING', 'RECONCILIATION_FAILED', 'WRITE_FAILED'].includes(event.status)) throw conflict();
    const scope = writebackScope(job.tenantId, approvalKey);
    let command = this.store.getIdempotent(scope);
    if (!command) {
      // Conservative upgrade of queued/running V38 work: prior attempts are never assumed absent.
      command = newWritebackCommand({tenantId: job.tenantId, event, matter, key: approvalKey, jobId: job.id});
      // Only a receipt attached to this authorized event has a proven tenant/event binding.
      const receipt = event.writeback;
      if (validId(receipt?.externalWriteId)) {
        command.externalWriteId = receipt.externalWriteId;
        command.state = event.status === 'COMPLETED' && event.writeback?.verified === true ? 'RECONCILED' : 'SUCCEEDED';
      } else if (job.attempts > 1 || job.payload.reconcileOnly) {
        command.state = 'OUTCOME_UNKNOWN';
        command.uncertain = true;
      }
      this.#persist(command);
    }
    if (command.tenantId !== job.tenantId || command.eventId !== event.id || command.matterId !== matter.id || command.externalMatterId !== matter.externalId || command.key !== approvalKey || (event.writeback?.commandKey && event.writeback.commandKey !== approvalKey)) throw conflict();
    return command;
  }
  #persist(command, audit = null) {
    return this.store.transaction(() => {
      const scope = writebackScope(command.tenantId, command.key);
      const current = this.store.getIdempotent(scope);
      // A late worker may never downgrade proven read-back success.
      if (current?.state === 'RECONCILED') return current;
      if (current) {
        const olderCycle = command.recoveryCount < current.recoveryCount;
        const sameCycle = command.recoveryCount === current.recoveryCount;
        command.writeAttempts = Math.max(command.writeAttempts, current.writeAttempts);
        command.totalReadAttempts = Math.max(command.totalReadAttempts, current.totalReadAttempts);
        if (sameCycle || olderCycle) command.reconciliationAttempts = Math.max(command.reconciliationAttempts, current.reconciliationAttempts);
        if (olderCycle) { command.recoveryCount = current.recoveryCount; command.jobId = current.jobId; }
      }
      const event = this.store.getEvent(command.tenantId, command.eventId);
      if (!event || event.approvedMatterId !== command.matterId) throw conflict();
      command.updatedAt = new Date().toISOString();
      this.store.setIdempotent(scope, command);
      const exhausted = command.reconciliationAttempts >= this.maxReads;
      event.status = command.state === 'RECONCILED' ? 'COMPLETED'
        : command.state === 'FAILED_KNOWN' && (!command.retryable || command.writeAttempts >= this.maxWrites) ? 'WRITE_FAILED'
        : command.uncertain ? 'OUTCOME_UNKNOWN'
        : ['SUCCEEDED', 'RECONCILING'].includes(command.state) ? (exhausted ? 'RECONCILIATION_FAILED' : 'RECONCILING') : 'APPROVED';
      event.writeback = {...view(command), commandKey: command.key};
      this.store.updateEvent(event);
      if (audit) this.store.audit({tenantId: command.tenantId, traceId: command.traceId, actorId: command.actorId, matterId: command.matterId, objectId: command.eventId, ...audit});
      return structuredClone(command);
    });
  }
  #finish(job, command) {
    this.store.completeJob(job.id);
    return {jobId: job.id, eventId: command.eventId, status: 'DONE', result: view(command)};
  }
  #wait(job, command, retry) {
    this.store.failJob(job.id, command.errorCode || 'WRITEBACK_UNVERIFIED', {retry});
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
        const latest = this.store.getIdempotent(writebackScope(job.tenantId, command.key));
        const mayWrite = !job.payload.reconcileOnly && (latest.state === 'PENDING' || latest.state === 'FAILED_KNOWN' && latest.retryable) && latest.writeAttempts < this.maxWrites;
        if (!mayWrite) return {command: latest, write: false};
        latest.state = 'ATTEMPTING';
        latest.writeAttempts += 1;
        latest.retryable = false;
        latest.errorCode = null;
        return {command: this.#persist(latest, {action: 'PROCLAIM_WRITE_ATTEMPTED', outcome: 'ATTEMPT'}), write: true};
      });
      command = attempt.command;
      if (attempt.write) {
        let receipt;
        try {
          receipt = await this.proclaim.createHistory({tenantId: command.tenantId, externalMatterId: command.externalMatterId, idempotencyKey: command.key, payload: {sourceEventId: command.eventId, classification: command.classification}});
        } catch (error) {
          if (error instanceof KnownWriteFailure) {
            command.state = 'FAILED_KNOWN';
            command.retryable = error.retryable;
            command.errorCode = error.code;
            command = this.#persist(command, {action: 'PROCLAIM_WRITE_FAILED_KNOWN', outcome: 'FAILED', reason: command.errorCode});
            if (command.state === 'RECONCILED') return this.#finish(job, command);
            return this.#wait(job, command, command.retryable && command.writeAttempts < this.maxWrites);
          }
          command.state = 'OUTCOME_UNKNOWN';
          command.uncertain = true;
          command.errorCode = 'EXTERNAL_WRITE_OUTCOME_UNKNOWN';
          command = this.#persist(command, {action: 'PROCLAIM_WRITE_UNCERTAIN', outcome: 'UNKNOWN', reason: command.errorCode});
        }
        if (receipt !== undefined) {
          if (validId(receipt?.externalWriteId)) {
            command.externalWriteId = receipt.externalWriteId;
            command.state = 'SUCCEEDED';
          } else {
            command.state = 'OUTCOME_UNKNOWN';
            command.uncertain = true;
            command.errorCode = 'INVALID_WRITE_RECEIPT';
          }
          command = this.#persist(command);
        } else if (command.state === 'ATTEMPTING') {
          command.state = 'OUTCOME_UNKNOWN'; command.uncertain = true; command.errorCode = 'INVALID_WRITE_RECEIPT';
          command = this.#persist(command);
        }
      }
      if (command.state === 'RECONCILED') return this.#finish(job, command);
      if (command.state === 'ATTEMPTING') {
        // A persisted attempt with no receipt may have reached the external service.
        command.state = 'OUTCOME_UNKNOWN'; command.uncertain = true; command.errorCode = 'EXTERNAL_WRITE_OUTCOME_UNKNOWN';
        command = this.#persist(command);
      }
      if (!['SUCCEEDED', 'OUTCOME_UNKNOWN', 'RECONCILING'].includes(command.state)) return this.#wait(job, command, false);
      if (command.reconciliationAttempts >= this.maxReads) return this.#wait(job, command, false);
      return await this.#reconcile(job, command);
    } catch {
      // Do not return/store adapter error text: it may contain credentials or source content.
      this.store.failJob(job.id, 'WRITEBACK_INTERNAL_ERROR', {retry: job.attempts < 3});
      return {jobId: job.id, eventId: job.payload.eventId, status: 'FAILED', error: 'WRITEBACK_INTERNAL_ERROR'};
    }
  }
  async #reconcile(job, command) {
    command.state = 'RECONCILING';
    command.reconciliationAttempts += 1;
    command.totalReadAttempts += 1;
    command = this.#persist(command);
    if (command.state === 'RECONCILED') return this.#finish(job, command);
    let history;
    try {
      history = await this.proclaim.getHistory({tenantId: command.tenantId, externalMatterId: command.externalMatterId});
      if (!Array.isArray(history)) throw new Error('invalid history contract');
    } catch {
      command.state = command.uncertain ? 'OUTCOME_UNKNOWN' : 'SUCCEEDED';
      command.errorCode = 'READBACK_UNAVAILABLE';
      command = this.#persist(command, {action: 'PROCLAIM_READBACK_PENDING', outcome: 'UNVERIFIED', reason: command.errorCode});
      if (command.state === 'RECONCILED') return this.#finish(job, command);
      return this.#wait(job, command, command.reconciliationAttempts < this.maxReads);
    }
    // This is the normalized synthetic adapter contract, not an assumption about live Proclaim.
    const matches = history.filter(item => item?.tenantId === command.tenantId && item.externalMatterId === command.externalMatterId && item.idempotencyKey === command.key && item.payload?.sourceEventId === command.eventId && item.payload?.classification === command.classification && validId(item.id));
    if (matches.length === 1 && (!command.externalWriteId || matches[0].id === command.externalWriteId)) {
      command.externalWriteId = matches[0].id;
      command.state = 'RECONCILED'; command.uncertain = false; command.errorCode = null;
      command = this.#persist(command, {action: 'PROCLAIM_WRITE_RECONCILED', outcome: 'SUCCESS'});
      return this.#finish(job, command);
    }
    command.state = command.uncertain ? 'OUTCOME_UNKNOWN' : 'SUCCEEDED';
    command.errorCode = matches.length > 1 ? 'AMBIGUOUS_READBACK' : 'READBACK_NOT_CONFIRMED';
    command = this.#persist(command, {action: 'PROCLAIM_READBACK_PENDING', outcome: 'UNVERIFIED', reason: command.errorCode});
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
      if (!command || command.tenantId !== tenantId || command.eventId !== eventId || command.key !== event.writeback?.commandKey || command.matterId !== event.approvedMatterId || !this.store.getMatter(tenantId, command.matterId)) throw conflict();
      const bound=job=>job&&job.tenantId===tenantId&&job.type==='PROCLAIM_WRITEBACK'&&job.payload?.eventId===eventId&&job.payload?.matterId===command.matterId&&job.payload?.approvalKey===command.key;
      const scope = requestScope(tenantId, idempotencyKey);
      const previous = this.store.getIdempotent(scope);
      if (previous) {
        if (previous.eventId !== eventId) throw conflict();
        if (previous.readOnly!==true||!['QUEUED','COMPLETED'].includes(previous.status)) throw unavailable();
        if (previous.jobId===null) {
          if (previous.status!=='COMPLETED'||command.state!=='RECONCILED') throw unavailable();
        } else if (previous.status!=='QUEUED'||!validId(previous.jobId)||!bound(this.store.getJob(previous.jobId))) throw unavailable();
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
          command.recoveryCount += 1;
          job = this.store.enqueue({tenantId, type: 'PROCLAIM_WRITEBACK', payload: {eventId, matterId: command.matterId, approvalKey: command.key, reconcileOnly: true}, traceId: command.traceId});
          command.jobId = job.id;
          this.#persist(command);
        }
      }
      if (job) this.store.makeWritebackJobReadOnly(tenantId, job.id);
      const result = {eventId, jobId: job?.id || null, status: command.state === 'RECONCILED' ? 'COMPLETED' : 'QUEUED', readOnly: true, replayed: false};
      this.store.setIdempotent(scope, result);
      this.store.audit({tenantId, actorId, traceId: event.traceId, action: 'PROCLAIM_RECONCILIATION_REQUESTED', objectId: eventId, matterId: command.matterId, outcome: 'READ_ONLY'});
      return result;
    });
  }
}
