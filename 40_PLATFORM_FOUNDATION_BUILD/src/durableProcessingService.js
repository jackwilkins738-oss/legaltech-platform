import {PostgresDeploymentDrainBackend} from './postgresDeploymentDrain.js';
import {REQUIRED_PRODUCTION_PROBES} from './productionAdmission.js';
import {createPostgresProcessingService} from './processingService.js';

// Same six processing pools plus three isolated drain principals. Deployment
// provisioning/initialization remain explicit; construction never opens pools.
export function createDurablePostgresProcessingService({processing,drain,http,probes,readiness,ingress,canaryIntervalMs}={}){
  if(!drain||Object.hasOwn(drain,'backend'))throw new Error('DURABLE_PROCESSING_DRAIN_OVERRIDE_FORBIDDEN');
  const {authorize,...options}=drain;
  const pools=[processing?.domain?.domainPool,processing?.domain?.relayPool,processing?.domain?.producerPool,
    processing?.worker?.workerPool,processing?.worker?.domainReaderPool,processing?.queueReaderPool,
    options.workerPool,options.operatorPool,options.readerPool];
  const roles=[processing?.domain?.expectedDomainRole,processing?.domain?.expectedRelayRole,processing?.domain?.expectedProducerRole,
    processing?.worker?.expectedWorkerRole,processing?.worker?.expectedDomainReaderRole,processing?.expectedQueueReaderRole,
    options.expectedWorkerRole,options.expectedOperatorRole,options.expectedReaderRole];
  if(pools.some(p=>!p)||new Set(pools).size!==9||roles.some(r=>typeof r!=='string')||new Set(roles).size!==9)throw new Error('DURABLE_PROCESSING_SEPARATE_POOLS_REQUIRED');
  const backend=new PostgresDeploymentDrainBackend(options);
  if(!probes||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length||REQUIRED_PRODUCTION_PROBES.some(k=>typeof Object.getOwnPropertyDescriptor(probes,k)?.value!=='function'))throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
  const original=probes.DEPLOYMENT_DRAIN;
  const bound={...probes,DEPLOYMENT_DRAIN:async({signal}={})=>{
    if(signal?.aborted||(await original({signal}))?.ok!==true)return {ok:false,code:'POSTGRES_DRAIN_UNVERIFIED'};return backend.probe({signal});
  }};
  return createPostgresProcessingService({processing,drain:{backend,authorize,deploymentId:options.deploymentId},http,probes:bound,readiness,ingress,canaryIntervalMs});
}
