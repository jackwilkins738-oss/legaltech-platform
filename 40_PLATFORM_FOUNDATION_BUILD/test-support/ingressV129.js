import {ManagedProcessingIngress} from '../src/managedProcessingIngress.js';
import {PostgresDomainJobHandlers} from '../src/postgresDomainHandlers.js';
import {fixtureDrain,ready,id} from './processingV126.js';
export const upload={tenantId:id(1),actorId:id(2),uploadId:id(3)};
export const graph={subscriptionId:id(4),notificationFingerprint:'a'.repeat(64)};
export const policy={tenantId:id(1),actorId:id(2),matterId:id(5),requestId:id(6)};
export const binding={tenantId:upload.tenantId,actorId:upload.actorId,sourceKey:upload.uploadId,payloadId:id(7),payloadHash:'b'.repeat(64),versionId:'immutable-v129',evidenceHash:'c'.repeat(64),revision:1,state:'PROCESSING_ALLOWED'};
export function ingressFixture(extra={}){
  const calls=[],audits=[],scopes=[],fixture=fixtureDrain(extra.backend),bindings={UPLOAD:{...binding},GRAPH:{...binding,sourceKey:graph.notificationFingerprint,subscriptionId:graph.subscriptionId,changeType:'created'},POLICY:{tenantId:policy.tenantId,actorId:policy.actorId,sourceKey:policy.requestId,matterId:policy.matterId,policyVersionId:id(8),policyVersionHash:'d'.repeat(64),versionId:'published-v129',evidenceHash:'c'.repeat(64),revision:1,state:'PUBLISHED'}};
  const handlers=new PostgresDomainJobHandlers({domainOutbox:{run:async()=>{}},authorizeDomain:async()=>true});
  const respond=kind=>async value=>{calls.push(value);return {tenantId:value.tenantId,commandId:value.commandId,jobId:value.jobId,kind,objectId:value.eventId??value.matterId,status:'ACCEPTED',replayed:false};};
  handlers.registerInbound=respond('PROCESS_INBOUND');handlers.requestPolicyEvaluation=respond('POLICY_EVALUATION');
  const configuration={handlers,drain:fixture.drain,readiness:ready(),namespace:id(9),resolveUpload:async()=>({...bindings.UPLOAD}),resolveGraph:async()=>({...bindings.GRAPH}),resolvePolicy:async()=>({...bindings.POLICY}),authorizeIngress:async v=>{scopes.push(v);return true;},verifySourceEvidence:async()=>true,audit:async v=>{audits.push(v);},probeSources:async()=>({ok:true}),...extra.configuration};
  extra.configure?.(configuration,bindings,calls);
  return {router:new ManagedProcessingIngress(configuration),configuration,bindings,calls,audits,scopes,fixture};
}
