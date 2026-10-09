import crypto from 'node:crypto';

const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const CONTROLS=new Set(['ALL_EGRESS','PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY','DOCUMENT_DELIVERY','NEW_SESSION']);
const EGRESS_OPS=new Set(['PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY']);
const clone=v=>structuredClone(v);
function id(value,error){if(typeof value!=='string'||!SAFE_ID.test(value))throw new Error(error);return value;}
function code(value,error){if(typeof value!=='string'||!CODE.test(value))throw new Error(error);return value;}
function exact(value,allowed,error){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(error);for(const k of Object.keys(value))if(!allowed.includes(k))throw new Error(error);return value;}

export class SecurityInterlockRegistry {
  #now;#authorize;#controls=new Map();#events=[];
  constructor({authorizeChange,now=()=>Date.now()}={}){if(typeof authorizeChange!=='function'||typeof now!=='function')throw new Error('SECURITY_INTERLOCK_CONFIGURATION_INVALID');this.#authorize=authorizeChange;this.#now=now;}
  activate(input){
    exact(input,['tenantId','control','actorId','traceId','incidentId','reasonCode'],'SECURITY_INTERLOCK_REQUEST_INVALID');
    const tenantId=id(input.tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED'),control=code(input.control,'SECURITY_INTERLOCK_CONTROL_INVALID'),actorId=id(input.actorId,'SECURITY_INTERLOCK_ACTOR_REQUIRED'),traceId=id(input.traceId,'SECURITY_INTERLOCK_TRACE_REQUIRED'),incidentId=id(input.incidentId,'SECURITY_INTERLOCK_INCIDENT_REQUIRED'),reasonCode=code(input.reasonCode,'SECURITY_INTERLOCK_REASON_INVALID');if(!CONTROLS.has(control))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');
    this.#assertChange({tenantId,actorId,control,action:'ACTIVATE'});const key=`${tenantId}:${control}`,prior=this.#controls.get(key);if(prior?.status==='ACTIVE'){if(prior.incidentId===incidentId&&prior.reasonCode===reasonCode)return Object.freeze({...clone(prior),replayed:true});throw new Error('SECURITY_INTERLOCK_ALREADY_ACTIVE');}
    const row={id:`sil_${crypto.randomUUID()}`,tenantId,control,status:'ACTIVE',incidentId,reasonCode,activatedBy:actorId,activatedAt:this.#at(),releasedBy:null,releasedAt:null,resolutionCode:null};this.#controls.set(key,row);this.#event(row,'INTERLOCK_ACTIVATED',actorId,traceId,{control,incidentId,reasonCode});return Object.freeze({...clone(row),replayed:false});
  }
  release(input){
    exact(input,['tenantId','control','actorId','traceId','resolutionCode'],'SECURITY_INTERLOCK_RELEASE_INVALID');const tenantId=id(input.tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED'),control=code(input.control,'SECURITY_INTERLOCK_CONTROL_INVALID'),actorId=id(input.actorId,'SECURITY_INTERLOCK_ACTOR_REQUIRED'),traceId=id(input.traceId,'SECURITY_INTERLOCK_TRACE_REQUIRED'),resolutionCode=code(input.resolutionCode,'SECURITY_INTERLOCK_RESOLUTION_INVALID');if(!CONTROLS.has(control))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');
    this.#assertChange({tenantId,actorId,control,action:'RELEASE'});const row=this.#controls.get(`${tenantId}:${control}`);if(!row)throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');if(row.status==='RELEASED')return Object.freeze(clone(row));if(row.activatedBy===actorId)throw new Error('SECURITY_INTERLOCK_DUAL_CONTROL_REQUIRED');row.status='RELEASED';row.releasedBy=actorId;row.releasedAt=this.#at();row.resolutionCode=resolutionCode;this.#event(row,'INTERLOCK_RELEASED',actorId,traceId,{control,resolutionCode});return Object.freeze(clone(row));
  }
  assertAllowed({tenantId,operation}){tenantId=id(tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED');operation=code(operation,'SECURITY_INTERLOCK_OPERATION_INVALID');const active=this.#active(tenantId);if(active.some(x=>x.control===operation)||(EGRESS_OPS.has(operation)&&active.some(x=>x.control==='ALL_EGRESS')))throw new Error('SECURITY_INTERLOCK_ACTIVE');return true;}
  status(tenantId){tenantId=id(tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED');return Object.freeze({tenantId,activeControls:Object.freeze(this.#active(tenantId).map(x=>x.control).sort())});}
  listEvents(tenantId){return Object.freeze(this.#events.filter(e=>e.tenantId===tenantId).map(e=>Object.freeze(clone(e))));}
  #active(tenantId){return [...this.#controls.values()].filter(x=>x.tenantId===tenantId&&x.status==='ACTIVE');}
  #assertChange(input){let ok=false;try{ok=this.#authorize(clone(input))===true;}catch{throw new Error('SECURITY_INTERLOCK_AUTHORIZATION_UNAVAILABLE');}if(!ok)throw new Error('SECURITY_INTERLOCK_FORBIDDEN');}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`sie_${crypto.randomUUID()}`,tenantId:row.tenantId,interlockId:row.id,eventType,actorId,traceId,at:this.#at(),evidence:clone(evidence)}));}
  #at(){return new Date(this.#now()).toISOString();}
}
export const SECURITY_INTERLOCK_CONTROLS=Object.freeze([...CONTROLS]);
