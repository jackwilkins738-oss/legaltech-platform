import crypto from 'node:crypto';

const clone = (x) => structuredClone(x);

export class IntegrationRegistry {
  constructor() { this.connections = new Map(); }
  #key(tenantId, kind) { return `${tenantId}:${kind}`; }
  upsert({tenantId, kind, mode='MOCK', status='NOT_CONFIGURED', capabilities=[], metadata={}, health={}}) {
    const key=this.#key(tenantId,kind); const previous=this.connections.get(key)||{};
    const item={id:previous.id||`con_${crypto.randomUUID()}`,tenantId,kind,mode,status,capabilities:[...capabilities],metadata:{...(previous.metadata||{}),...metadata},health:{...(previous.health||{}),...health},updatedAt:new Date().toISOString()};
    this.connections.set(key,item); return clone(item);
  }
  get(tenantId,kind){const x=this.connections.get(this.#key(tenantId,kind));return x?clone(x):null;}
  list(tenantId){return [...this.connections.values()].filter(x=>x.tenantId===tenantId).map(clone);}
}

export function integrationSummary(registry, tenantId) {
  return registry.list(tenantId).map(x=>({kind:x.kind,mode:x.mode,status:x.status,capabilities:x.capabilities,health:x.health,metadata:x.metadata,updatedAt:x.updatedAt}));
}
