// Synthetic adapters only: actual PostgreSQL execution is covered in CI.
import crypto from 'node:crypto';
import {PostgresGraphInboxProducer,PostgresGraphInboxWorker,PostgresGraphInboxReader} from '../src/postgresGraphInbox.js';
import {graphApprovedSourceVersionHash} from '../src/managedProcessingIngress.js';
import {ManagedGraphWebhookIntake,graphSourceDeliveryFingerprint} from '../src/managedGraphWebhookIntake.js';
import {ingressFixture} from './ingressV129.js';
import {id} from './processingV126.js';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),state=new WeakMap();
class Producer extends PostgresGraphInboxProducer {
  async enqueueBatch(values,options){const s=state.get(this);s.producerCalls.push(values);if(s.enqueue)return s.enqueue(values,options);return Object.freeze(values.map(v=>{
    const key=JSON.stringify([v.tenantId,v.subscriptionId,v.notificationFingerprint]),prior=s.jobs.get(key);if(prior){if(prior.sourceEvidenceHash!==v.sourceEvidenceHash||prior.eventType!==v.eventType)throw new Error('GRAPH_INBOX_CONFLICT');return {...prior,replayed:true};}
    const row={...v,status:'QUEUED',attempt:0,maxAttempts:5,requestHash:sha(key)};s.jobs.set(key,row);return {...row,replayed:false};
  }));}
  async probe(options){const s=state.get(this);return s.probe?s.probe(options):{ok:true};}
}
class Worker extends PostgresGraphInboxWorker {
  async claimNext(input){const s=state.get(this);if(s.claim)return s.claim(input);const row=[...s.jobs.values()].find(v=>v.tenantId===input.tenantId&&v.status==='QUEUED');if(!row)return null;row.status='RUNNING';row.attempt++;const claim={...row,workerId:id(20),token:crypto.randomBytes(32).toString('hex')};s.claims.push(claim);return claim;}
  async assertCurrent(claim,options){const s=state.get(this);s.assertions.push(claim);return s.assert?s.assert(claim,options):true;}
  async complete(claim,options){const s=state.get(this);s.completions.push({claim,options});if(s.complete)return s.complete(claim,options);s.jobs.get(JSON.stringify([claim.tenantId,claim.subscriptionId,claim.notificationFingerprint])).status='DONE';return true;}
  async fail(claim,options){const s=state.get(this);s.failures.push({claim,options});if(s.fail)return s.fail(claim,options);s.jobs.get(JSON.stringify([claim.tenantId,claim.subscriptionId,claim.notificationFingerprint])).status=options.retryable?'QUEUED':'DEAD';return true;}
  async probe(options){const s=state.get(this);return s.probe?s.probe(options):{ok:true};}
}
class Reader extends PostgresGraphInboxReader {
  async probe(options){const s=state.get(this);return s.probe?s.probe(options):{ok:true};}
}
export function graphFixture(extra={}){
  const ingress=extra.ingress??ingressFixture(extra.ingressOptions),jobs=new Map(),s={jobs,producerCalls:[],claims:[],assertions:[],completions:[],failures:[],...extra.state};
  const pool={connect:async()=>{throw new Error('NO_REAL_DB_IN_UNIT_FIXTURE');}},authorize=async()=>true;
  const producer=new Producer({pool,expectedRole:'synthetic_graph_producer',actorId:id(2),authorizeEnqueue:authorize});
  const worker=new Worker({pool,expectedRole:'synthetic_graph_worker',actorId:id(2),workerId:id(20),authorizeWorker:authorize});
  const reader=new Reader({pool,expectedRole:'synthetic_graph_reader',actorId:id(2),authorizeRead:authorize});
  for(const v of [producer,worker,reader])state.set(v,s);
  const subscription={tenantId:id(1),subscriptionId:id(4),directoryTenantId:id(11),clientState:'synthetic-only-v132-state',status:'ACTIVE',expiresAt:new Date(Date.now()+3600000).toISOString(),richData:false};
  const payload={value:[{id:'synthetic-notification-v132',tenantId:id(11),subscriptionId:id(4),clientState:subscription.clientState,resource:'sites/synthetic/drive/items/synthetic',changeType:'created',subscriptionExpirationDateTime:subscription.expiresAt}]};
  const sources=[],authorizations=[],controls=[];
  const config={producer,worker,reader,processingIngress:ingress.router,resolveSubscription:async()=>({...subscription}),
    registerSource:async row=>{
      sources.push(row);const eventType={created:'CREATED',updated:'UPDATED',deleted:'DELETED',unknownFutureValue:'UNKNOWN',missed:'MISSED',subscriptionRemoved:'SUBSCRIPTION_REMOVED',reauthorizationRequired:'REAUTHORIZATION_REQUIRED'}[row.changeType??row.lifecycleEvent];
      const version={...ingress.bindings.GRAPH,subscriptionId:row.subscriptionId,changeType:row.changeType},sourceVersionHash=graphApprovedSourceVersionHash(version);
      const receipt={tenantId:row.tenantId,subscriptionId:row.subscriptionId,validatedFingerprint:row.notificationFingerprint,sourceEvidenceHash:'c'.repeat(64),sourceVersionHash};
      const notificationFingerprint=graphSourceDeliveryFingerprint({...receipt,eventType});if(['created','updated'].includes(row.changeType))Object.assign(ingress.bindings.GRAPH,{sourceKey:notificationFingerprint,subscriptionId:row.subscriptionId,changeType:row.changeType});
      return {...receipt,notificationFingerprint};
    },
    authorizeDispatch:async row=>{authorizations.push(row);return true;},dispatchControl:async row=>{controls.push(row);return {tenantId:row.tenantId,subscriptionId:row.subscriptionId,notificationFingerprint:row.notificationFingerprint,sourceEvidenceHash:row.sourceEvidenceHash,sourceVersionHash:row.sourceVersionHash,status:'ACCEPTED'};},probeGraph:async()=>({ok:true}),drain:ingress.fixture.drain,readiness:ingress.configuration.readiness,...extra.config};
  extra.configure?.(config,s,subscription,payload,ingress);
  return {intake:new ManagedGraphWebhookIntake(config),config,s,subscription,payload,sources,authorizations,controls,ingress,fixture:ingress.fixture};
}
