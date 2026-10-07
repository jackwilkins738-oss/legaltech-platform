import crypto from 'node:crypto';import {appError} from './errors.js';
import {integrationRecord,integrationOptions,integrationJson} from './integrationInput.js';
const clone=x=>structuredClone(x);
const invalid=()=>appError('invalid integration record',{code:'INVALID_REQUEST'});
const identifier=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
export class IntegrationRegistry {
  #connections=new Map();
  #key(tenantId,kind){return JSON.stringify([tenantId,kind]);}
  #commit(input,expected=null){
    const {tenantId,kind,mode,status,capabilities,metadata,health}=integrationOptions(input,{tenantId:undefined,kind:undefined,mode:'MOCK',status:'NOT_CONFIGURED',capabilities:[],metadata:{},health:{}});
    if(!identifier(tenantId)||!identifier(kind,64)||!identifier(mode,64)||!identifier(status,100)||!Array.isArray(capabilities)||capabilities.length>100||!integrationRecord(metadata)||!integrationRecord(health))throw invalid();
    const caps=integrationJson(capabilities);if(!caps.every(value=>identifier(value,128)))throw invalid();const ownedMetadata=integrationJson(metadata),ownedHealth=integrationJson(health),key=this.#key(tenantId,kind),previous=this.#connections.get(key);
    if(expected&&(!previous||previous.id!==expected.id||previous.revision!==expected.revision))return null;
    const revision=(previous?.revision??0)+1;if(!Number.isSafeInteger(revision)||revision<1)throw invalid();
    const item=integrationJson({id:previous?.id||`con_${crypto.randomUUID()}`,tenantId,kind,mode,status,capabilities:[...new Set(caps)],metadata:{...(previous?.metadata||{}),...ownedMetadata},health:{...(previous?.health||{}),...ownedHealth},revision,updatedAt:new Date().toISOString()});
    // Validate/copy before replacing a record; conditional writes recheck its identity.
    if(expected&&this.#connections.get(key)!==previous)return null;
    this.#connections.set(key,item);return clone(item);
  }
  upsert(input){return this.#commit(input);}
  updateIfCurrent(input,proof){const expected=integrationOptions(proof,{id:undefined,revision:undefined});if(!identifier(expected.id)||!Number.isSafeInteger(expected.revision)||expected.revision<1)throw invalid();return this.#commit(input,expected);}
  get(tenantId,kind){if(!identifier(tenantId)||!identifier(kind,64))throw invalid();const item=this.#connections.get(this.#key(tenantId,kind));return item?clone(item):null;}
  list(tenantId){if(!identifier(tenantId))throw invalid();return [...this.#connections.values()].filter(item=>item.tenantId===tenantId).map(clone);}
}
export function integrationSummary(registry,tenantId){return registry.list(tenantId).map(item=>({kind:item.kind,mode:item.mode,status:item.status,capabilities:item.capabilities,health:item.health,metadata:item.metadata,revision:item.revision,updatedAt:item.updatedAt}));}
