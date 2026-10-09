import {createPostgresDomainPipeline} from './postgresDomainPipeline.js';
import {createPostgresWorkerPipeline} from './postgresWorkerPipeline.js';

// Deployment owns pools and admission. All five principals remain separate;
// construction does not connect, process jobs, close pools or enable HTTP routes.
export function createPostgresProcessingPipeline({domain,worker}={}) {
  if(!domain||!worker||!domain.drain||domain.drain!==worker.drain)throw new Error('PROCESSING_PIPELINE_SHARED_DRAIN_REQUIRED');
  const pools=[domain.domainPool,domain.relayPool,domain.producerPool,worker.workerPool,worker.domainReaderPool];
  const roles=[domain.expectedDomainRole,domain.expectedRelayRole,domain.expectedProducerRole,worker.expectedWorkerRole,worker.expectedDomainReaderRole];
  if(pools.some(p=>!p)||new Set(pools).size!==5||new Set(roles).size!==5)throw new Error('PROCESSING_PIPELINE_SEPARATE_POOLS_REQUIRED');
  const requests=createPostgresDomainPipeline(domain),execution=createPostgresWorkerPipeline(worker);
  const status=()=>Object.freeze({relay:requests.supervisor.status(),worker:execution.supervisor.status()});
  const stop=async options=>{const [relay,worker]=await Promise.all([requests.supervisor.stop(options),execution.supervisor.stop(options)]);return Object.freeze({drained:relay.drained&&worker.drained,relay,worker});};
  let starting=false;
  return Object.freeze({handlers:requests.handlers,runtime:execution.runtime,status,stop,
    async start(options){
      if(starting||[requests.supervisor.status(),execution.supervisor.status()].some(s=>s.inFlight||!['IDLE','STOPPED','FAILED'].includes(s.state)))throw new Error('PROCESSING_PIPELINE_ALREADY_ACTIVE');
      starting=true;
      try{requests.supervisor.start(options);execution.supervisor.start(options);return status();}
      catch{const result=await stop();throw new Error(result.drained?'PROCESSING_PIPELINE_START_FAILED':'PROCESSING_PIPELINE_START_UNDRAINED');}
      finally{starting=false;}
    },
    async probe(){const [relay,worker]=await Promise.all([requests.relayProbe(),execution.workerProbe()]);return Object.freeze({ok:relay.ok&&worker.ok,relay,worker});}
  });
}
