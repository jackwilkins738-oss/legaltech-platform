import crypto from 'node:crypto';
import {appError} from './errors.js';
const clone=x=>structuredClone(x);
const invalid=()=>appError('invalid integration record',{code:'INVALID_REQUEST'});
const identifier=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function safeJson(value) {
  let nodes=0;const ancestors=new Set();
  function visit(x,depth) {
    if(++nodes>5000||depth>10)throw invalid();
    if(x===null||typeof x==='boolean'||typeof x==='string')return;
    if(typeof x==='number'&&Number.isFinite(x))return;
    if(typeof x!=='object'||(!Array.isArray(x)&&!record(x))||ancestors.has(x))throw invalid();
    if(Array.isArray(x)&&x.length>1000)throw invalid();
    ancestors.add(x);
    for(const [name,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(x))) {
      if(Array.isArray(x)&&name==='length')continue;
      if(!Object.hasOwn(descriptor,'value'))throw invalid();
      visit(descriptor.value,depth+1);
    }
    ancestors.delete(x);
  }
  try{visit(value,0);if(Buffer.byteLength(JSON.stringify(value))>256*1024)throw invalid();}
  catch {throw invalid();}
}
export class IntegrationRegistry {
  constructor(){this.connections=new Map();}
  #key(tenantId,kind){return JSON.stringify([tenantId,kind]);}
  upsert({tenantId,kind,mode='MOCK',status='NOT_CONFIGURED',capabilities=[],metadata={},health={}}) {
    if(!identifier(tenantId)||!identifier(kind,64)||!identifier(mode,64)||!identifier(status,100)||!Array.isArray(capabilities)||capabilities.length>100||!Array.from(capabilities).every(x=>identifier(x,128))||!record(metadata)||!record(health))throw invalid();
    safeJson(metadata);safeJson(health);
    const key=this.#key(tenantId,kind),previous=this.connections.get(key)||{};
    const revision=(previous.revision??0)+1;if(!Number.isSafeInteger(revision)||revision<1)throw invalid();
    const item={id:previous.id||`con_${crypto.randomUUID()}`,tenantId,kind,mode,status,capabilities:[...new Set(capabilities)],metadata:{...(previous.metadata||{}),...metadata},health:{...(previous.health||{}),...health},revision,updatedAt:new Date().toISOString()};
    safeJson(item);
    let owned;try{owned=clone(item);}catch {throw invalid();}
    this.connections.set(key,owned);return clone(owned);
  }
  get(tenantId,kind){if(!identifier(tenantId)||!identifier(kind,64))throw invalid();const x=this.connections.get(this.#key(tenantId,kind));return x?clone(x):null;}
  list(tenantId){if(!identifier(tenantId))throw invalid();return [...this.connections.values()].filter(x=>x.tenantId===tenantId).map(clone);}
}
export function integrationSummary(registry,tenantId) {
  return registry.list(tenantId).map(x=>({kind:x.kind,mode:x.mode,status:x.status,capabilities:x.capabilities,health:x.health,metadata:x.metadata,revision:x.revision,updatedAt:x.updatedAt}));
}
