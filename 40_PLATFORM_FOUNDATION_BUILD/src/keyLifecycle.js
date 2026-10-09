import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const PURPOSE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const HEX64=/^[a-f0-9]{64}$/;
const clone=v=>structuredClone(v);
function id(v,code){if(typeof v!=='string'||!ID.test(v))throw new Error(code);return v;}
function purpose(v){if(typeof v!=='string'||!PURPOSE.test(v))throw new Error('KEY_PURPOSE_INVALID');return v;}
function hash(v,code){if(typeof v!=='string'||!HEX64.test(v))throw new Error(code);return v;}
function exact(v,keys,code){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(code);for(const k of Object.keys(v))if(!keys.includes(k))throw new Error(code);return v;}

export class KeyLifecycleRegistry {
  #authorize;#now;#rows=new Map();#events=[];
  constructor({authorizeChange,now=()=>Date.now()}={}){if(typeof authorizeChange!=='function'||typeof now!=='function')throw new Error('KEY_LIFECYCLE_CONFIGURATION_INVALID');this.#authorize=authorizeChange;this.#now=now;}
  registerInitial(input){
    exact(input,['tenantId','purpose','keyAlias','generation','providerKeyFingerprint','actorId','traceId'],'KEY_GENERATION_REQUEST_INVALID');const tenantId=id(input.tenantId,'KEY_TENANT_REQUIRED'),p=purpose(input.purpose),keyAlias=id(input.keyAlias,'KEY_ALIAS_INVALID'),actorId=id(input.actorId,'KEY_ACTOR_REQUIRED'),traceId=id(input.traceId,'KEY_TRACE_REQUIRED'),generation=Number(input.generation),fingerprint=hash(input.providerKeyFingerprint,'KEY_FINGERPRINT_INVALID');if(generation!==1)throw new Error('KEY_GENERATION_SEQUENCE_INVALID');this.#allow({tenantId,purpose:p,actorId,action:'REGISTER'});const key=this.#key(tenantId,p);if(this.#rows.has(key))throw new Error('KEY_GENERATION_EXISTS');const row=this.#row({tenantId,purpose:p,keyAlias,generation,providerKeyFingerprint:fingerprint,status:'ACTIVE',createdBy:actorId});this.#rows.set(key,[row]);this.#event(row,'KEY_GENERATION_REGISTERED',actorId,traceId,{generation,fingerprint});return Object.freeze(clone(row));
  }
  rotate(input){
    exact(input,['tenantId','purpose','keyAlias','generation','providerKeyFingerprint','actorId','traceId'],'KEY_ROTATION_REQUEST_INVALID');const tenantId=id(input.tenantId,'KEY_TENANT_REQUIRED'),p=purpose(input.purpose),keyAlias=id(input.keyAlias,'KEY_ALIAS_INVALID'),actorId=id(input.actorId,'KEY_ACTOR_REQUIRED'),traceId=id(input.traceId,'KEY_TRACE_REQUIRED'),generation=Number(input.generation),fingerprint=hash(input.providerKeyFingerprint,'KEY_FINGERPRINT_INVALID');this.#allow({tenantId,purpose:p,actorId,action:'ROTATE'});const rows=this.#rows.get(this.#key(tenantId,p));if(!rows?.length)throw new Error('KEY_GENERATION_UNAVAILABLE');const current=rows.find(r=>r.status==='ACTIVE');if(!current)throw new Error('KEY_ACTIVE_GENERATION_MISSING');const highest=Math.max(...rows.map(r=>r.generation));if(!Number.isSafeInteger(generation)||generation!==highest+1)throw new Error('KEY_GENERATION_SEQUENCE_INVALID');if(rows.some(r=>r.providerKeyFingerprint===fingerprint))throw new Error('KEY_GENERATION_FINGERPRINT_REUSE');current.status='DECRYPT_ONLY';current.rotatedAt=this.#at();const row=this.#row({tenantId,purpose:p,keyAlias,generation,providerKeyFingerprint:fingerprint,status:'ACTIVE',createdBy:actorId});rows.push(row);this.#event(current,'KEY_GENERATION_DECRYPT_ONLY',actorId,traceId,{generation:current.generation});this.#event(row,'KEY_GENERATION_ROTATED',actorId,traceId,{generation,fingerprint});return Object.freeze(clone(row));
  }
  retire(input){
    exact(input,['tenantId','purpose','generation','actorId','traceId','retirementEvidenceHash'],'KEY_RETIRE_REQUEST_INVALID');const tenantId=id(input.tenantId,'KEY_TENANT_REQUIRED'),p=purpose(input.purpose),actorId=id(input.actorId,'KEY_ACTOR_REQUIRED'),traceId=id(input.traceId,'KEY_TRACE_REQUIRED'),generation=Number(input.generation),evidence=hash(input.retirementEvidenceHash,'KEY_RETIRE_EVIDENCE_INVALID');this.#allow({tenantId,purpose:p,actorId,action:'RETIRE'});const row=this.#rows.get(this.#key(tenantId,p))?.find(x=>x.generation===generation);if(!row)throw new Error('KEY_GENERATION_UNAVAILABLE');if(row.status!=='DECRYPT_ONLY')throw new Error('KEY_GENERATION_NOT_RETIRABLE');row.status='RETIRED';row.retiredAt=this.#at();row.retirementEvidenceHash=evidence;this.#event(row,'KEY_GENERATION_RETIRED',actorId,traceId,{generation,retirementEvidenceHash:evidence});return Object.freeze(clone(row));
  }
  encryptionBinding({tenantId,purpose:rawPurpose}={}){const p=purpose(rawPurpose),rows=this.#rows.get(this.#key(id(tenantId,'KEY_TENANT_REQUIRED'),p)),row=rows?.find(x=>x.status==='ACTIVE');if(!row)throw new Error('KEY_ACTIVE_GENERATION_MISSING');return Object.freeze({version:1,tenantId:row.tenantId,purpose:row.purpose,keyAlias:row.keyAlias,generation:row.generation,providerKeyFingerprint:row.providerKeyFingerprint});}
  assertDecryptBinding(binding){
    exact(binding,['version','tenantId','purpose','keyAlias','generation','providerKeyFingerprint'],'KEY_BINDING_INVALID');if(binding.version!==1)throw new Error('KEY_BINDING_INVALID');const tenantId=id(binding.tenantId,'KEY_BINDING_INVALID'),p=purpose(binding.purpose),keyAlias=id(binding.keyAlias,'KEY_BINDING_INVALID'),generation=Number(binding.generation),fingerprint=hash(binding.providerKeyFingerprint,'KEY_BINDING_INVALID'),row=this.#rows.get(this.#key(tenantId,p))?.find(x=>x.generation===generation);
    if(!row||row.keyAlias!==keyAlias||row.providerKeyFingerprint!==fingerprint||!['ACTIVE','DECRYPT_ONLY'].includes(row.status))throw new Error('KEY_DECRYPT_GENERATION_UNAVAILABLE');return true;
  }
  listPublic(tenantId,rawPurpose){tenantId=id(tenantId,'KEY_TENANT_REQUIRED');const p=purpose(rawPurpose);return Object.freeze((this.#rows.get(this.#key(tenantId,p))??[]).map(({retirementEvidenceHash,...r})=>Object.freeze({...clone(r),retirementEvidenceHash:retirementEvidenceHash??null})));}
  listEvents(tenantId){tenantId=id(tenantId,'KEY_TENANT_REQUIRED');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
  #row({tenantId,purpose,keyAlias,generation,providerKeyFingerprint,status,createdBy}){return {id:`keyg_${crypto.randomUUID()}`,tenantId,purpose,keyAlias,generation,providerKeyFingerprint,status,createdBy,createdAt:this.#at(),rotatedAt:null,retiredAt:null,retirementEvidenceHash:null};}
  #allow(value){let ok=false;try{ok=this.#authorize(clone(value))===true;}catch{throw new Error('KEY_CHANGE_AUTHORIZATION_UNAVAILABLE');}if(!ok)throw new Error('KEY_CHANGE_FORBIDDEN');}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`kye_${crypto.randomUUID()}`,tenantId:row.tenantId,purpose:row.purpose,generation:row.generation,eventType,actorId,traceId,at:this.#at(),evidence:Object.freeze(clone(evidence))}));}
  #key(t,p){return `${t}:${p}`;}#at(){return new Date(this.#now()).toISOString();}
}
