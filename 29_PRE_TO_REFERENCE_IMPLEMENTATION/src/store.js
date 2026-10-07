import crypto from 'node:crypto';

export class MemoryStore {
  constructor(seed = {}) {
    this.matters = new Map();
    this.events = new Map();
    this.exceptions = new Map();
    this.audits = [];
    this.writebacks = new Map();
    this.idempotency = new Map();
    this.reset(seed);
  }

  reset(seed = {}) {
    this.matters.clear();
    this.events.clear();
    this.exceptions.clear();
    this.audits = [];
    this.writebacks.clear();
    this.idempotency.clear();
    for (const m of seed.matters || []) this.matters.set(m.id, structuredClone(m));
  }

  uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

  audit(entry) {
    const item = { id: this.uid('aud'), at: new Date().toISOString(), ...entry };
    this.audits.push(item);
    return item;
  }

  listTenantMatters(tenantId) {
    return [...this.matters.values()].filter(m => m.tenantId === tenantId);
  }

  getMatter(tenantId, matterId) {
    const m = this.matters.get(matterId);
    return m && m.tenantId === tenantId ? structuredClone(m) : null;
  }

  findMatterByExternalRef(tenantId, ref) {
    return this.listTenantMatters(tenantId).filter(m => (m.externalRefs || []).includes(ref));
  }
}
