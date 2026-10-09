import {createPostgresProcessingPipeline} from './postgresProcessingPipeline.js';
import {PostgresDomainOutbox} from './postgresOutbox.js';
import {PostgresJobReader} from './postgresJobs.js';
import {ManagedWorkerArtifacts} from './managedWorkerArtifacts.js';
import {PostgresResultAdopter} from './postgresResultAdoption.js';
import {ProcessingCanary} from './processingCanary.js';
import {createProductionReadiness,REQUIRED_PRODUCTION_PROBES} from './productionAdmission.js';

// The SDK, evidence verification and permissions remain explicit deployment
// dependencies. The factory supplies the actual loader/adopter/readiness wiring.
export function createPostgresManagedProcessing({domain,worker,artifacts,queueReaderPool,expectedQueueReaderRole,authorizeResultRead,authorizeAdoption,canary}={}){
  if(!domain||!worker||!queueReaderPool||[domain.domainPool,domain.relayPool,domain.producerPool,worker.workerPool,worker.domainReaderPool].includes(queueReaderPool)
    ||[domain.expectedDomainRole,domain.expectedRelayRole,domain.expectedProducerRole,worker.expectedWorkerRole,worker.expectedDomainReaderRole].includes(expectedQueueReaderRole))throw new Error('MANAGED_PROCESSING_SEPARATE_POOLS_REQUIRED');
  if(Object.hasOwn(worker,'loadPayload')||Object.hasOwn(worker,'loadPolicy'))throw new Error('MANAGED_PROCESSING_ARTIFACT_OVERRIDE_FORBIDDEN');
  const providers=new ManagedWorkerArtifacts(artifacts);
  const pipeline=createPostgresProcessingPipeline({domain,worker:{...worker,loadPayload:providers.loadPayload.bind(providers),loadPolicy:providers.loadPolicy.bind(providers)}});
  const jobReader=new PostgresJobReader({pool:queueReaderPool,expectedRole:expectedQueueReaderRole,authorizeRead:authorizeResultRead,timeoutMs:worker.timeoutMs??5000});
  const domainOutbox=new PostgresDomainOutbox({pool:domain.domainPool,expectedRole:domain.expectedDomainRole,authorizeAppend:domain.authorizeAppend,timeoutMs:domain.timeoutMs??5000});
  const resultAdopter=new PostgresResultAdopter({domainOutbox,jobReader,authorizeAdoption});
  // Protected bindings follow the caller's options so a canary cannot replace
  // this factory's actual pipeline or its durable result reader/adopter.
  const functional=new ProcessingCanary({...canary,pipeline,resultAdopter});
  const processingProbe=async({signal}={})=>{
    try{if(signal?.aborted)return {ok:false,code:'MANAGED_PROCESSING_UNVERIFIED'};const a=await providers.probe({signal});
      if(!a.ok||signal?.aborted)return {ok:false,code:'MANAGED_PROCESSING_UNVERIFIED'};const b=await pipeline.probe();
      if(!b.ok||signal?.aborted)return {ok:false,code:'MANAGED_PROCESSING_UNVERIFIED'};const c=await functional.probe({signal});
      return Object.freeze({ok:c.ok&&!signal?.aborted,code:c.ok&&!signal?.aborted?'MANAGED_PROCESSING_VERIFIED':'MANAGED_PROCESSING_UNVERIFIED'});
    }catch{return Object.freeze({ok:false,code:'MANAGED_PROCESSING_UNVERIFIED'});}
  };
  return Object.freeze({...pipeline,
    async start(options){
      if(Object.values(pipeline.status()).some(s=>s.inFlight||!['IDLE','STOPPED','FAILED'].includes(s.state)))throw new Error('PROCESSING_PIPELINE_ALREADY_ACTIVE');
      functional.resume();try{return await pipeline.start(options);}catch(error){await functional.stop();throw error;}},
    async stop(options){const [background,canary]=await Promise.all([pipeline.stop(options),functional.stop(options)]);return Object.freeze({...background,canary,drained:background.drained&&canary.drained});},
    probe:processingProbe,resultAdopter,canary:functionalFacade(functional),
    createReadiness({probes,...options}={}){
      if(!probes||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length||REQUIRED_PRODUCTION_PROBES.some(k=>typeof Object.getOwnPropertyDescriptor(probes,k)?.value!=='function'))throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
      const bound=Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,probes[k]]));
      const original=Object.freeze({...bound});
      const combine=async(signal,first,second)=>{if(signal?.aborted)return {ok:false,code:'PROCESSING_DEPENDENCY_UNVERIFIED'};const a=await first({signal});if(signal?.aborted||a?.ok!==true)return {ok:false,code:'PROCESSING_DEPENDENCY_UNVERIFIED'};const b=await second({signal});return {ok:!signal?.aborted&&b?.ok===true,code:!signal?.aborted&&b?.ok===true?'PROCESSING_DEPENDENCY_VERIFIED':'PROCESSING_DEPENDENCY_UNVERIFIED'};};
      bound.OBJECT_STORAGE=({signal})=>combine(signal,original.OBJECT_STORAGE,providers.probe.bind(providers));
      bound.QUEUE=async({signal})=>{const a=await combine(signal,original.QUEUE,pipeline.probe);if(!a.ok)return a;return functional.probe({signal});};
      bound.WORKER_AUTHORIZATION=({signal})=>combine(signal,original.WORKER_AUTHORIZATION,functional.probe.bind(functional));
      for(const key of ['OBJECT_STORAGE','QUEUE','WORKER_AUTHORIZATION']){
        const probe=bound[key];let pending=null;
        bound[key]=context=>{if(pending)return Promise.resolve({ok:false,code:'PROCESSING_PROBE_BUSY'});
          const task=Promise.resolve().then(()=>probe(context));pending=task;task.finally(()=>{if(pending===task)pending=null;}).catch(()=>{});return task;};
      }
      return createProductionReadiness({...options,probes:bound});
    }
  });
}
function functionalFacade(value){return Object.freeze({run:value.run.bind(value),probe:value.probe.bind(value)});}
