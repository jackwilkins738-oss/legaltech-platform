import {PostgresDeploymentDrainBackend} from './postgresDeploymentDrain.js';
import {REQUIRED_PRODUCTION_PROBES} from './productionAdmission.js';
import {createPostgresProcessingService} from './processingService.js';

// Same six processing pools plus three isolated drain principals. Deployment
// provisioning/initialization remain explicit; construction never opens pools.
export function createDurablePostgresProcessingService({processing,drain,http,probes,readiness,ingress,webhooks,review,canaryIntervalMs}={}){
  if(!drain||Object.hasOwn(drain,'backend'))throw new Error('DURABLE_PROCESSING_DRAIN_OVERRIDE_FORBIDDEN');
  const {authorize,...options}=drain;
  const pools=[processing?.domain?.domainPool,processing?.domain?.relayPool,processing?.domain?.producerPool,
    processing?.worker?.workerPool,processing?.worker?.domainReaderPool,processing?.queueReaderPool,
    options.workerPool,options.operatorPool,options.readerPool];
  const roles=[processing?.domain?.expectedDomainRole,processing?.domain?.expectedRelayRole,processing?.domain?.expectedProducerRole,
    processing?.worker?.expectedWorkerRole,processing?.worker?.expectedDomainReaderRole,processing?.expectedQueueReaderRole,
    options.expectedWorkerRole,options.expectedOperatorRole,options.expectedReaderRole];
  if(pools.some(p=>!p)||new Set(pools).size!==9||roles.some(r=>typeof r!=='string')||new Set(roles).size!==9)throw new Error('DURABLE_PROCESSING_SEPARATE_POOLS_REQUIRED');
  if(webhooks!==undefined){
    const graphPools=[webhooks?.producerOptions?.pool,webhooks?.workerOptions?.pool,webhooks?.readerOptions?.pool];
    const graphRoles=[webhooks?.producerOptions?.expectedRole,webhooks?.workerOptions?.expectedRole,webhooks?.readerOptions?.expectedRole];
    if(graphPools.some(p=>!p)||new Set([...pools,...graphPools]).size!==12||graphRoles.some(r=>typeof r!=='string')||new Set([...roles,...graphRoles]).size!==12)throw new Error('DURABLE_PROCESSING_GRAPH_SEPARATE_POOLS_REQUIRED');
  }
  if(review!==undefined){
    const allPools=[...pools,...(webhooks?[webhooks.producerOptions?.pool,webhooks.workerOptions?.pool,webhooks.readerOptions?.pool]:[])];
    const allRoles=[...roles,...(webhooks?[webhooks.producerOptions?.expectedRole,webhooks.workerOptions?.expectedRole,webhooks.readerOptions?.expectedRole]:[])];
    if(typeof review?.pool?.connect!=='function'||allPools.includes(review.pool)||typeof review.expectedRole!=='string'||allRoles.includes(review.expectedRole))throw new Error('DURABLE_PROCESSING_REVIEW_SEPARATE_POOL_REQUIRED');
  }
  const backend=new PostgresDeploymentDrainBackend(options);
  if(!probes||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length||REQUIRED_PRODUCTION_PROBES.some(k=>typeof Object.getOwnPropertyDescriptor(probes,k)?.value!=='function'))throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
  const original=probes.DEPLOYMENT_DRAIN;
  const bound={...probes,DEPLOYMENT_DRAIN:async({signal}={})=>{
    if(signal?.aborted||(await original({signal}))?.ok!==true)return {ok:false,code:'POSTGRES_DRAIN_UNVERIFIED'};return backend.probe({signal});
  }};
  return createPostgresProcessingService({processing,drain:{backend,authorize,deploymentId:options.deploymentId},http,probes:bound,readiness,ingress,webhooks,review,canaryIntervalMs});
}
