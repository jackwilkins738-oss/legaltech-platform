import {PostgresDomainOutbox,PostgresOutboxRelay} from './postgresOutbox.js';
import {PostgresJobProducer} from './postgresJobs.js';
import {PostgresDomainJobHandlers} from './postgresDomainHandlers.js';
import {OutboxRelaySupervisor} from './outboxRelaySupervisor.js';

// Explicit deployment-root composition: three separate, directly authenticated
// pools and current authorization. Construction never starts a timer or worker.
export function createPostgresDomainPipeline({domainPool,expectedDomainRole,relayPool,expectedRelayRole,producerPool,expectedProducerRole,
  authorizeDomain,authorizeAppend,authorizeRelay,authorizeEnqueue,getScopes,authorizeScope,drain,timeoutMs=5000,
  pollIntervalMs=1000,cycleTimeoutMs=30000,maxScopes=100,batchSize=25}={}) {
  if(!domainPool||!relayPool||!producerPool||new Set([domainPool,relayPool,producerPool]).size!==3
    ||new Set([expectedDomainRole,expectedRelayRole,expectedProducerRole]).size!==3)throw new Error('DOMAIN_PIPELINE_SEPARATE_POOLS_REQUIRED');
  const domainOutbox=new PostgresDomainOutbox({pool:domainPool,expectedRole:expectedDomainRole,timeoutMs,authorizeAppend});
  const jobProducer=new PostgresJobProducer({pool:producerPool,expectedRole:expectedProducerRole,timeoutMs,authorizeEnqueue});
  const handlers=new PostgresDomainJobHandlers({domainOutbox,authorizeDomain});
  const relay=new PostgresOutboxRelay({pool:relayPool,expectedRole:expectedRelayRole,timeoutMs,authorizeRelay,jobProducer});
  const supervisor=new OutboxRelaySupervisor({relay,getScopes,authorizeScope,drain,pollIntervalMs,cycleTimeoutMs,maxScopes,batchSize});
  return Object.freeze({handlers,supervisor,relayProbe:()=>supervisor.probe()});
}
