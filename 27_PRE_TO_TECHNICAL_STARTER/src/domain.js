import crypto from 'node:crypto';

export function id(prefix='id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function eventEnvelope({tenantId,eventType,sourceSystem,sourceId=null,matterId=null,payload={}}) {
  if (!tenantId || !eventType || !sourceSystem) throw new Error('missing required event field');
  const now = new Date().toISOString();
  return Object.freeze({
    event_id:id('evt'), tenant_id:tenantId, event_type:eventType, event_version:1,
    occurred_at:now, received_at:now, source_system:sourceSystem, source_id:sourceId,
    matter_id:matterId, trace_id:id('trace'), payload
  });
}

export class IdempotencyStore {
  #keys = new Map();
  claim(key, value=true) {
    if (!key) throw new Error('idempotency key required');
    if (this.#keys.has(key)) return {duplicate:true,value:this.#keys.get(key)};
    this.#keys.set(key,value); return {duplicate:false,value};
  }
}

export class AuditLog {
  entries=[];
  record({tenantId,actor='system',action,objectType,objectId,outcome='SUCCESS',traceId,reason=null}) {
    if (!tenantId || !action || !objectType || !objectId || !traceId) throw new Error('invalid audit event');
    const entry={timestamp:new Date().toISOString(),tenantId,actor,action,objectType,objectId,outcome,traceId,reason};
    this.entries.push(Object.freeze(entry));
    return entry;
  }
}
