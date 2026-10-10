import crypto from 'node:crypto';
import {LifecycleTransitionGuard,exactLifecycleRecord,discardLifecyclePromise} from './lifecycleTransition.js';

const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const CONTROLS=new Set(['ALL_EGRESS','PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY','NEW_SESSION']);
const EGRESS_OPS=new Set(['PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY']);
const clone=v=>structuredClone(v);
function id(value,error){if(typeof value!=='string'||!SAFE_ID.test(value))throw new Error(error);return value;}
function code(value,error){if(typeof value!=='string'||!CODE.test(value))throw new Error(error);return value;}
const exact=exactLifecycleRecord;

export class SecurityInterlockRegistry {
  #guard;#transitionAt=null;#authorize;#controls=new Map();#events=[];
  constructor({authorizeChange,now=()=>Date.now()}={}){if(typeof authorizeChange!=='function'||typeof now!=='function')throw new Error('SECURITY_INTERLOCK_CONFIGURATION_INVALID');this.#authorize=authorizeChange;this.#guard=new LifecycleTransitionGuard(now,'SECURITY_INTERLOCK');}
  activate(input){
    return this.#change(()=>{
      exact(input,['tenantId','control','actorId','traceId','incidentId','reasonCode'],'SECURITY_INTERLOCK_REQUEST_INVALID');
      const tenantId=id(input.tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED'),control=code(input.control,'SECURITY_INTERLOCK_CONTROL_INVALID'),actorId=id(input.actorId,'SECURITY_INTERLOCK_ACTOR_REQUIRED'),traceId=id(input.traceId,'SECURITY_INTERLOCK_TRACE_REQUIRED'),incidentId=id(input.incidentId,'SECURITY_INTERLOCK_INCIDENT_REQUIRED'),reasonCode=code(input.reasonCode,'SECURITY_INTERLOCK_REASON_INVALID');if(!CONTROLS.has(control))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');
      this.#assertChange({tenantId,actorId,control,action:'ACTIVATE'});const key=JSON.stringify([tenantId,control]),prior=this.#controls.get(key);if(prior?.status==='ACTIVE'){if(prior.incidentId===incidentId&&prior.reasonCode===reasonCode)return Object.freeze({...clone(prior),replayed:true});throw new Error('SECURITY_INTERLOCK_ALREADY_ACTIVE');}
      const row={id:`sil_${crypto.randomUUID()}`,tenantId,control,status:'ACTIVE',incidentId,reasonCode,activatedBy:actorId,activatedAt:this.#at(),releasedBy:null,releasedAt:null,resolutionCode:null};this.#controls.set(key,row);this.#event(row,'INTERLOCK_ACTIVATED',actorId,traceId,{control,incidentId,reasonCode});return Object.freeze({...clone(row),replayed:false});
    });
  }
  release(input){
    return this.#change(()=>{
      exact(input,['tenantId','control','interlockId','incidentId','actorId','traceId','resolutionCode'],'SECURITY_INTERLOCK_RELEASE_INVALID');const tenantId=id(input.tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED'),control=code(input.control,'SECURITY_INTERLOCK_CONTROL_INVALID'),actorId=id(input.actorId,'SECURITY_INTERLOCK_ACTOR_REQUIRED'),traceId=id(input.traceId,'SECURITY_INTERLOCK_TRACE_REQUIRED'),resolutionCode=code(input.resolutionCode,'SECURITY_INTERLOCK_RESOLUTION_INVALID'),interlockId=id(input.interlockId,'SECURITY_INTERLOCK_RELEASE_INVALID'),incidentId=id(input.incidentId,'SECURITY_INTERLOCK_RELEASE_INVALID');if(!CONTROLS.has(control))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');
      const row=this.#controls.get(JSON.stringify([tenantId,control]));if(!row)throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');if(row.id!==interlockId||row.incidentId!==incidentId)throw new Error('SECURITY_INTERLOCK_RELEASE_STALE');this.#assertChange({tenantId,actorId,control,interlockId,incidentId,resolutionCode,action:'RELEASE'});if(row.status==='RELEASED'){if(row.releasedBy!==actorId||row.resolutionCode!==resolutionCode)throw new Error('SECURITY_INTERLOCK_RELEASE_REPLAY_MISMATCH');return Object.freeze({...clone(row),replayed:true});}if(row.activatedBy===actorId)throw new Error('SECURITY_INTERLOCK_DUAL_CONTROL_REQUIRED');row.status='RELEASED';row.releasedBy=actorId;row.releasedAt=this.#at();row.resolutionCode=resolutionCode;this.#event(row,'INTERLOCK_RELEASED',actorId,traceId,{control,incidentId,resolutionCode});return Object.freeze({...clone(row),replayed:false});
    });
  }
  releaseBinding({tenantId,control}){tenantId=id(tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED');if(!CONTROLS.has(control))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');const row=this.#controls.get(JSON.stringify([tenantId,control]));if(!row)throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');return Object.freeze({tenantId,control,interlockId:row.id,incidentId:row.incidentId});}
  assertAllowed({tenantId,operation}){tenantId=id(tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED');operation=code(operation,'SECURITY_INTERLOCK_OPERATION_INVALID');const active=this.#active(tenantId);if(active.some(x=>x.control===operation)||(EGRESS_OPS.has(operation)&&active.some(x=>x.control==='ALL_EGRESS')))throw new Error('SECURITY_INTERLOCK_ACTIVE');return true;}
  status(tenantId){tenantId=id(tenantId,'SECURITY_INTERLOCK_TENANT_REQUIRED');return Object.freeze({tenantId,activeControls:Object.freeze(this.#active(tenantId).map(x=>x.control).sort())});}
  listEvents(tenantId){return Object.freeze(this.#events.filter(e=>e.tenantId===tenantId).map(e=>Object.freeze(clone(e))));}
  #active(tenantId){return [...this.#controls.values()].filter(x=>x.tenantId===tenantId&&x.status==='ACTIVE');}
  #assertChange(input){let ok=false;try{const result=this.#authorize(Object.freeze(clone(input)));discardLifecyclePromise(result);ok=result===true;}catch{throw new Error('SECURITY_INTERLOCK_AUTHORIZATION_UNAVAILABLE');}if(!ok)throw new Error('SECURITY_INTERLOCK_FORBIDDEN');}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`sie_${crypto.randomUUID()}`,tenantId:row.tenantId,interlockId:row.id,eventType,actorId,traceId,at:this.#at(),evidence:clone(evidence)}));}
  #at(){return this.#transitionAt;}
  #change(work){
    const priorControls=this.#controls,priorEvents=this.#events,priorAt=this.#transitionAt;
    try{return this.#guard.run(at=>{
      this.#transitionAt=at;this.#controls=new Map([...priorControls].map(([key,row])=>[key,clone(row)]));this.#events=[...priorEvents];return work();
    });}catch(error){this.#controls=priorControls;this.#events=priorEvents;throw error;}
    finally{this.#transitionAt=priorAt;}
  }
}
export const SECURITY_INTERLOCK_CONTROLS=Object.freeze([...CONTROLS]);
