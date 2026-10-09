import {PostgresJobWorker} from './postgresJobs.js';
import {PostgresWorkerDomainLoader} from './postgresWorkerDomain.js';
import {PostgresWorkerRuntime} from './postgresWorkerRuntime.js';
import {WorkerSupervisor} from './workerSupervisor.js';

export function createPostgresWorkerPipeline({workerPool,expectedWorkerRole,domainReaderPool,expectedDomainReaderRole,workerId,
  authorizeWorker,authorizeDomainRead,authorizeExecution,loadPayload,loadPolicy,processInbound,evaluatePolicy,
  getScopes,authorizeScope,drain,timeoutMs=5000,executionTimeoutMs=60000,heartbeatIntervalMs=1000,maxPayloadBytes,maxPolicyBytes,
  pollIntervalMs=1000,cycleTimeoutMs=60000,maxScopes=100,batchSize=25,recoveryLimit=25}={}) {
  if(!workerPool||!domainReaderPool||workerPool===domainReaderPool||expectedWorkerRole===expectedDomainReaderRole)throw new Error('WORKER_PIPELINE_SEPARATE_POOLS_REQUIRED');
  const worker=new PostgresJobWorker({pool:workerPool,expectedRole:expectedWorkerRole,workerId,authorizeWorker,timeoutMs});
  const loader=new PostgresWorkerDomainLoader({pool:domainReaderPool,expectedRole:expectedDomainReaderRole,authorizeRead:authorizeDomainRead,timeoutMs});
  const runtime=new PostgresWorkerRuntime({jobWorker:worker,domainLoader:loader,authorizeExecution,loadPayload,loadPolicy,processInbound,evaluatePolicy,executionTimeoutMs,heartbeatIntervalMs,maxPayloadBytes,maxPolicyBytes});
  const supervisor=new WorkerSupervisor({runtime,getScopes,authorizeScope,drain,pollIntervalMs,cycleTimeoutMs,maxScopes,batchSize,recoveryLimit});
  return Object.freeze({runtime,supervisor,workerProbe:async()=>{await worker.probe();await loader.probe();return supervisor.probe();}});
}
