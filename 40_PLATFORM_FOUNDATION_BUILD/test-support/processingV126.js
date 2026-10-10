import crypto from 'node:crypto';
import {ManagedDeploymentDrain} from '../src/managedDeploymentDrain.js';
import {createProductionReadiness,REQUIRED_PRODUCTION_PROBES} from '../src/productionAdmission.js';
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const HASH='a'.repeat(64);
export const session={tenantId:id(1),actorId:id(2),capabilities:['inbound:create','policy:evaluate'],authContext:{method:'OIDC',mfaVerified:false}};
export const inbound={commandId:id(3),jobId:id(4),eventId:id(5),payloadId:id(6),payloadHash:HASH,sourceSystem:'MANUAL_UPLOAD',externalEventId:'test-only-event'};
export const policy={commandId:id(7),jobId:id(8),matterId:id(9),policyVersionId:id(10),policyVersionHash:HASH};
export const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
export const tick=()=>new Promise(r=>setImmediate(r));
export function fixtureDrain(overrides={},authorize=async()=>true){
  let state='ACTIVE',generation=1;const held=new Map(),history=new Map(),calls=[];
  const view=()=>({state,generation,inFlight:held.size,acceptingNew:state==='ACTIVE'});
  const backend={
    async acquire(input){calls.push(['acquire',input]);if(state!=='ACTIVE')throw new Error('test-only-closed');const value={token:`synthetic_${crypto.randomUUID()}`,generation};held.set(input.operationId,value);history.set(input.operationId,{state:'HELD',lease:value});return {...value};},
    async release(input){calls.push(['release',input]);const value=held.get(input.operationId)??history.get(input.operationId)?.lease;if(!value||value.token!==input.lease.token)throw new Error('test-only-unknown');held.delete(input.operationId);history.set(input.operationId,{state:'RELEASED',lease:value});if(state==='DRAINING'&&!held.size)state='DRAINED';return {released:true,...value};},
    async status(){return view();},
    async begin(input){calls.push(['begin',input]);state=held.size?'DRAINING':'DRAINED';generation++;return view();},
    async resume(input){calls.push(['resume',input]);if(state!=='DRAINED'||held.size||generation!==input.expectedGeneration)throw new Error('test-only-CAS');state='ACTIVE';generation++;return view();},
    async lookupOperation(input){return history.get(input.operationId)??{state:'ABSENT',lease:null};},
  };
  const drain=new ManagedDeploymentDrain({backend:{...backend,...overrides},authorize,deploymentId:'test-only-deployment'});
  return {drain,backend,calls,held,history};
}
export const ready=()=>createProductionReadiness({probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true,code:'SYNTHETIC_TEST_ONLY'})])),probeTimeoutMs:100});
export function httpOptions(extra={}){
  const input=[],audits=[];
  const respond=kind=>async value=>{input.push(value);return {tenantId:value.tenantId,commandId:value.commandId,jobId:value.jobId,kind,objectId:value.eventId??value.matterId,status:'ACCEPTED',replayed:false};};
  const f=fixtureDrain();return {input,audits,fixture:f,options:{handlers:{registerInbound:respond('PROCESS_INBOUND'),requestPolicyEvaluation:respond('POLICY_EVALUATION')},authProvider:{authenticate:async()=>session},abuseLimiter:{checkIp:async()=>{},checkTenant:async()=>{}},readiness:ready(),drain:f.drain,authorizeRequest:async()=>true,audit:async value=>{audits.push(value);},...extra}};
}
