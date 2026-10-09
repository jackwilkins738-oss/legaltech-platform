import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const HASH=/^[a-f0-9]{64}$/;
const KINDS=new Set(['WORKFLOW','RESPONSE_POLICY','FEATURE_FLAG','ROUTING_POLICY','NOTIFICATION_POLICY']);
const clone=v=>structuredClone(v);
const digest=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');
function id(v,c,max=256){if(typeof v!=='string'||!v.trim()||v.length>max||!ID.test(v.trim()))throw new Error(c);return v.trim();}
function exact(v,allowed,c){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(c);for(const k of Object.keys(v))if(!allowed.includes(k))throw new Error(c);return v;}
function component(v){exact(v,['kind','ref','hash'],'TENANT_CONFIG_COMPONENT_INVALID');if(!KINDS.has(v.kind))throw new Error('TENANT_CONFIG_COMPONENT_KIND_INVALID');const ref=id(v.ref,'TENANT_CONFIG_COMPONENT_REF_INVALID');if(typeof v.hash!=='string'||!HASH.test(v.hash))throw new Error('TENANT_CONFIG_COMPONENT_HASH_INVALID');return Object.freeze({kind:v.kind,ref,hash:v.hash});}
export const hashTenantConfiguration=({bundleKey,version,components})=>digest({bundleKey,version,components});

export class TenantConfigurationRegistry {
  #now;#change;#validate;#assertValidated;#bundles=new Map();#active=new Map();#events=[];
  constructor({changeControl,validateComponent,assertValidated,now=()=>Date.now()}={}){if(!changeControl||typeof changeControl.executeApproved!=='function'||typeof validateComponent!=='function'||typeof assertValidated!=='function'||typeof now!=='function')throw new Error('TENANT_CONFIG_CONFIGURATION_INVALID');this.#change=changeControl;this.#validate=validateComponent;this.#assertValidated=assertValidated;this.#now=now;}
  createDraft({tenantId,bundleKey='OPERATING',components,basedOnVersion=null,actorId,traceId}){
    tenantId=id(tenantId,'TENANT_CONFIG_TENANT_REQUIRED');bundleKey=id(bundleKey,'TENANT_CONFIG_KEY_INVALID',100);actorId=id(actorId,'TENANT_CONFIG_ACTOR_REQUIRED');traceId=id(traceId,'TENANT_CONFIG_TRACE_REQUIRED');
    if(!Array.isArray(components)||components.length<1||components.length>64)throw new Error('TENANT_CONFIG_COMPONENTS_INVALID');const clean=components.map(component).sort((a,b)=>a.kind.localeCompare(b.kind)||a.ref.localeCompare(b.ref));
    if(new Set(clean.map(x=>`${x.kind}:${x.ref}`)).size!==clean.length)throw new Error('TENANT_CONFIG_COMPONENT_DUPLICATE');
    for(const item of clean){let ok=false;try{ok=this.#validate(Object.freeze({tenantId,...item}))===true;}catch{throw new Error('TENANT_CONFIG_REFERENCE_VALIDATION_UNAVAILABLE');}if(!ok)throw new Error('TENANT_CONFIG_REFERENCE_INVALID');}
    const versions=this.#versions(tenantId,bundleKey),version=(versions.at(-1)?.version??0)+1;if(basedOnVersion!==null&&(!Number.isInteger(basedOnVersion)||!versions.some(x=>x.version===basedOnVersion)))throw new Error('TENANT_CONFIG_BASE_VERSION_INVALID');
    const bundleHash=hashTenantConfiguration({bundleKey,version,components:clean}),row={id:`tcb_${crypto.randomUUID()}`,tenantId,bundleKey,version,status:'DRAFT',components:clean,bundleHash,basedOnVersion,createdBy:actorId,createdAt:this.#at(),publishedAt:null};this.#bundles.set(`${tenantId}:${bundleKey}:${version}`,row);this.#event(row,'TENANT_CONFIG_DRAFT_CREATED',actorId,traceId,{bundleHash,componentCount:clean.length,basedOnVersion});return Object.freeze(clone(row));
  }
  activate({tenantId,bundleKey='OPERATING',version,actorId,traceId,changeId}){
    tenantId=id(tenantId,'TENANT_CONFIG_TENANT_REQUIRED');bundleKey=id(bundleKey,'TENANT_CONFIG_KEY_INVALID',100);actorId=id(actorId,'TENANT_CONFIG_ACTOR_REQUIRED');traceId=id(traceId,'TENANT_CONFIG_TRACE_REQUIRED');if(!Number.isInteger(version)||version<1)throw new Error('TENANT_CONFIG_VERSION_INVALID');
    const row=this.#bundles.get(`${tenantId}:${bundleKey}:${version}`);if(!row)throw new Error('TENANT_CONFIG_BUNDLE_UNAVAILABLE');const ref=`${bundleKey}@${version}`;
    let validated=false;try{validated=this.#assertValidated(Object.freeze({tenantId,bundleKey,version,bundleHash:row.bundleHash}))===true;}catch(error){if(error?.message==='TENANT_CONFIG_SYNTHETIC_CERTIFICATION_REQUIRED')throw error;throw new Error('TENANT_CONFIG_VALIDATION_UNAVAILABLE');}if(!validated)throw new Error('TENANT_CONFIG_SYNTHETIC_CERTIFICATION_REQUIRED');
    const execute=()=>{const current=this.#active.get(`${tenantId}:${bundleKey}`),action=current&&current.version>version?'ROLLBACK':'ACTIVATE';if(row.status==='DRAFT'){row.status='PUBLISHED';row.publishedAt=this.#at();}else if(row.status!=='PUBLISHED')throw new Error('TENANT_CONFIG_BUNDLE_UNAVAILABLE');this.#active.set(`${tenantId}:${bundleKey}`,row);this.#event(row,action==='ROLLBACK'?'TENANT_CONFIG_ROLLED_BACK':'TENANT_CONFIG_ACTIVATED',actorId,traceId,{bundleHash:row.bundleHash,previousVersion:current?.version??null,version});return Object.freeze(clone(row));};
    if(!changeId)throw new Error('TENANT_CONFIG_CHANGE_APPROVAL_REQUIRED');return this.#change.executeApproved({tenantId,changeId,changeType:'TENANT_CONFIG_ACTIVATE',targetRef:ref,targetHash:row.bundleHash,actorId,traceId},execute);
  }
  get(tenantId,bundleKey,version){const row=this.#bundles.get(`${tenantId}:${bundleKey}:${version}`);return row?Object.freeze(clone(row)):null;}
  current(tenantId,bundleKey='OPERATING'){const row=this.#active.get(`${tenantId}:${bundleKey}`);return row?Object.freeze(clone(row)):null;}
  events(tenantId){return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
  #versions(tenantId,bundleKey){return [...this.#bundles.values()].filter(x=>x.tenantId===tenantId&&x.bundleKey===bundleKey).sort((a,b)=>a.version-b.version);}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`tce_${crypto.randomUUID()}`,tenantId:row.tenantId,bundleId:row.id,bundleKey:row.bundleKey,version:row.version,eventType,actorId,traceId,occurredAt:this.#at(),evidence:Object.freeze(clone(evidence))}));}
  #at(){return new Date(this.#now()).toISOString();}
}
