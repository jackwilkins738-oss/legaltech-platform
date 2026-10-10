import {ManagedReviewDecisions} from './managedReviewDecisions.js';
import {PostgresReviewDecisions} from './postgresReviewDecisions.js';
import {PostgresDomainOutbox} from './postgresOutbox.js';
import {ManagedGraphWebhookIntake} from './managedGraphWebhookIntake.js';
import {PostgresGraphInboxProducer,PostgresGraphInboxWorker,PostgresGraphInboxReader} from './postgresGraphInbox.js';
import {OutboxRelaySupervisor} from './outboxRelaySupervisor.js';
import {ManagedProcessingIngress,createGraphProcessingDispatch} from './managedProcessingIngress.js';
import {ManagedDeploymentDrain,isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {createPostgresManagedProcessing} from './postgresManagedProcessing.js';
import {createProcessingHttp} from './processingHttp.js';
import {REQUIRED_PRODUCTION_PROBES} from './productionAdmission.js';

// Deployment supplies provider implementations and principals; this root binds
// the same shared drain to HTTP, relay, workers and mandatory readiness.
export function createPostgresProcessingService({processing,drain:drainOptions,http,probes,readiness:readinessOptions,ingress:ingressOptions,webhooks:graphOptions,review:reviewOptions,canaryIntervalMs=10000}={}){
  if(http&&['allowDirectCommands','graphIntake','reviewIntake'].some(k=>Object.hasOwn(http,k)))throw new Error('PROCESSING_SERVICE_HTTP_OVERRIDE_FORBIDDEN');
  const drain=new ManagedDeploymentDrain(drainOptions);
  if(!processing?.domain||!processing?.worker||Object.hasOwn(processing.domain,'drain')||Object.hasOwn(processing.worker,'drain'))throw new Error('PROCESSING_SERVICE_DRAIN_OVERRIDE_FORBIDDEN');
  const age=processing.canary?.maxAgeMs??30000;
  if(!Number.isInteger(canaryIntervalMs)||canaryIntervalMs<100||canaryIntervalMs>age/2)throw new Error('PROCESSING_SERVICE_CONFIGURATION_INVALID');
  const pipeline=createPostgresManagedProcessing({...processing,domain:{...processing.domain,drain},worker:{...processing.worker,drain}});
  if(!probes||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length||REQUIRED_PRODUCTION_PROBES.some(k=>typeof Object.getOwnPropertyDescriptor(probes,k)?.value!=='function'))throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
  let ingress,graphIntake,graphSupervisor,reviewIntake;
  if(graphOptions!==undefined){
    if(!ingressOptions||!graphOptions||Object.getPrototypeOf(graphOptions)!==Object.prototype||Reflect.ownKeys(graphOptions).some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(graphOptions,k)??{},'value'))||['producer','worker','reader','processingIngress','drain','readiness','operation','relay'].some(k=>Object.hasOwn(graphOptions,k)))throw new Error('PROCESSING_SERVICE_GRAPH_OVERRIDE_FORBIDDEN');
    const graphPools=[graphOptions.producerOptions?.pool,graphOptions.workerOptions?.pool,graphOptions.readerOptions?.pool];
    const graphRoles=[graphOptions.producerOptions?.expectedRole,graphOptions.workerOptions?.expectedRole,graphOptions.readerOptions?.expectedRole];
    const processingPools=[processing.domain.domainPool,processing.domain.relayPool,processing.domain.producerPool,processing.worker.workerPool,processing.worker.domainReaderPool,processing.queueReaderPool];
    const processingRoles=[processing.domain.expectedDomainRole,processing.domain.expectedRelayRole,processing.domain.expectedProducerRole,processing.worker.expectedWorkerRole,processing.worker.expectedDomainReaderRole,processing.expectedQueueReaderRole];
    if(graphPools.some(p=>typeof p?.connect!=='function')||new Set([...processingPools,...graphPools]).size!==9||graphRoles.some(r=>typeof r!=='string')||new Set([...processingRoles,...graphRoles]).size!==9)throw new Error('PROCESSING_SERVICE_GRAPH_SEPARATE_POOLS_REQUIRED');
  }
  if(reviewOptions!==undefined){
    if(!reviewOptions||Object.getPrototypeOf(reviewOptions)!==Object.prototype||Reflect.ownKeys(reviewOptions).some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(reviewOptions,k)??{},'value'))||['reviews','domainOutbox','drain','readiness'].some(k=>Object.hasOwn(reviewOptions,k)))throw new Error('PROCESSING_SERVICE_REVIEW_OVERRIDE_FORBIDDEN');
    const pools=[processing.domain.domainPool,processing.domain.relayPool,processing.domain.producerPool,processing.worker.workerPool,processing.worker.domainReaderPool,processing.queueReaderPool,...(graphOptions?[graphOptions.producerOptions.pool,graphOptions.workerOptions.pool,graphOptions.readerOptions.pool]:[])];
    const roles=[processing.domain.expectedDomainRole,processing.domain.expectedRelayRole,processing.domain.expectedProducerRole,processing.worker.expectedWorkerRole,processing.worker.expectedDomainReaderRole,processing.expectedQueueReaderRole,...(graphOptions?[graphOptions.producerOptions.expectedRole,graphOptions.workerOptions.expectedRole,graphOptions.readerOptions.expectedRole]:[])];
    if(typeof reviewOptions.pool?.connect!=='function'||pools.includes(reviewOptions.pool)||roles.includes(reviewOptions.expectedRole))throw new Error('PROCESSING_SERVICE_REVIEW_SEPARATE_POOL_REQUIRED');
  }
  const sourceProbes={...probes};
  if(ingressOptions!==undefined){
    if(!ingressOptions||['handlers','drain','readiness'].some(k=>Object.hasOwn(ingressOptions,k)))throw new Error('PROCESSING_SERVICE_INGRESS_OVERRIDE_FORBIDDEN');
    const storage=sourceProbes.OBJECT_STORAGE;
    sourceProbes.OBJECT_STORAGE=async({signal}={})=>{
      if(signal?.aborted||(await storage({signal}))?.ok!==true)return {ok:false,code:'PROCESSING_INGRESS_UNVERIFIED'};
      return ingress?ingress.probe({signal}):{ok:false,code:'PROCESSING_INGRESS_UNVERIFIED'};
    };
  }
  if(graphOptions!==undefined){
    const queue=sourceProbes.QUEUE;
    sourceProbes.QUEUE=async({signal}={})=>{
      if(signal?.aborted||(await queue({signal}))?.ok!==true||!graphIntake||graphSupervisor?.status().state!=='RUNNING')return {ok:false,code:'GRAPH_INBOX_UNVERIFIED'};
      return graphIntake.probe({signal});
    };
  }
  if(reviewOptions!==undefined){
    const authorization=sourceProbes.WORKER_AUTHORIZATION;
    sourceProbes.WORKER_AUTHORIZATION=async({signal}={})=>{
      if(signal?.aborted||(await authorization({signal}))?.ok!==true||!reviewIntake)return {ok:false,code:'REVIEW_UNVERIFIED'};
      return reviewIntake.probe({signal});
    };
  }
  const original=probes.DEPLOYMENT_DRAIN;
  const readiness=pipeline.createReadiness({...readinessOptions,probes:{...sourceProbes,DEPLOYMENT_DRAIN:async({signal})=>{
    if(signal?.aborted||(await original({signal}))?.ok!==true)return {ok:false,code:'MANAGED_DRAIN_UNVERIFIED'};const result=await drain.probe();return signal?.aborted?{ok:false,code:'MANAGED_DRAIN_UNVERIFIED'}:result;
  }}});
  if(ingressOptions!==undefined)ingress=new ManagedProcessingIngress({...ingressOptions,handlers:pipeline.handlers,drain,readiness});
  let composed=pipeline,graphReader;
  if(graphOptions!==undefined){
    const producer=new PostgresGraphInboxProducer(graphOptions.producerOptions),worker=new PostgresGraphInboxWorker(graphOptions.workerOptions);
    graphReader=new PostgresGraphInboxReader(graphOptions.readerOptions);
    graphIntake=new ManagedGraphWebhookIntake({...graphOptions,producer,worker,reader:graphReader,processingIngress:ingress,drain,readiness});
    graphSupervisor=new OutboxRelaySupervisor({...graphOptions,relay:graphIntake,drain,operation:'GRAPH_WEBHOOK_DISPATCH_CYCLE'});
    composed=Object.freeze({...pipeline,
      async start(options){graphIntake.resume();await pipeline.start(options);graphSupervisor.start(options);},
      async stop(options){const results=await Promise.allSettled([graphIntake.stop(options),graphSupervisor.stop(options),pipeline.stop(options)]);return Object.freeze({drained:results.every(r=>r.status==='fulfilled'&&r.value.drained===true)});},
    });
  }
  if(reviewOptions!==undefined){
    const domainOutbox=new PostgresDomainOutbox({pool:reviewOptions.pool,expectedRole:reviewOptions.expectedRole,authorizeAppend:reviewOptions.authorizeAppend,timeoutMs:reviewOptions.transactionTimeoutMs??5000});
    const reviews=new PostgresReviewDecisions({domainOutbox,authorizeDecision:reviewOptions.authorizeDecision});
    reviewIntake=new ManagedReviewDecisions({...reviewOptions,reviews,drain,readiness});
    const original=composed;
    composed=Object.freeze({...original,
      async start(options){reviewIntake.resume();return original.start(options);},
      async stop(options){const results=await Promise.allSettled([reviewIntake.stop(options),original.stop(options)]);return Object.freeze({drained:results.every(r=>r.status==='fulfilled'&&r.value.drained===true)});},
    });
  }
  const service=createProcessingService({pipeline:composed,drain,readiness,http:{...http,allowDirectCommands:ingressOptions===undefined,graphIntake,reviewIntake},canaryIntervalMs});
  return Object.freeze({...service,ingress,graphDispatch:ingress?createGraphProcessingDispatch(ingress):undefined,graphIntake,graphReader,reviewIntake});
}

// Separately exported lifecycle for adapter contract tests. Production uses the
// PostgreSQL factory above; arbitrary fake callbacks cannot attest deployment.
export function createProcessingService({pipeline,drain,readiness,http,canaryIntervalMs=10000}={}){
  if(!isManagedDeploymentDrain(drain)||['start','stop','status'].some(k=>typeof pipeline?.[k]!=='function')||typeof pipeline?.canary?.run!=='function'||!Number.isInteger(canaryIntervalMs)||canaryIntervalMs<100||canaryIntervalMs>30000)throw new Error('PROCESSING_SERVICE_CONFIGURATION_INVALID');
  let state='IDLE',refresh=null,timer=null,controller=null,transition=null,shutdown=null,cleanup=null;
  if(http&&['handlers','readiness','drain','accepting'].some(k=>Object.hasOwn(http,k)))throw new Error('PROCESSING_SERVICE_HTTP_OVERRIDE_FORBIDDEN');
  const api=createProcessingHttp({...http,handlers:pipeline.handlers,readiness,drain,accepting:()=>state==='RUNNING'});
  const invalidate=()=>readiness.invalidate();
  const launch=()=>{
    if(state!=='RUNNING'||refresh)return;
    invalidate();const task=Promise.resolve().then(()=>pipeline.canary.run({signal:controller.signal}));refresh=task;
    task.finally(()=>{if(refresh===task)refresh=null;invalidate();if(state==='RUNNING')timer=setTimeout(launch,canaryIntervalMs);}).catch(()=>{});
  };
  const listen=({port,host})=>new Promise((resolve,reject)=>{const error=()=>{api.server.off('listening',ready);reject(new Error('PROCESSING_SERVICE_LISTEN_FAILED'));};const ready=()=>{api.server.off('error',error);resolve();};api.server.once('error',error);api.server.once('listening',ready);api.server.listen(port,host);});
  const close=()=>new Promise(resolve=>{if(!api.server.listening)return resolve();api.server.close(()=>resolve());api.server.closeIdleConnections();});
  const executeStop=async({actorId,reasonHash,timeoutMs})=>{
    state='STOPPING';invalidate();clearTimeout(timer);timer=null;controller?.abort();
    const httpStop=api.stop({timeoutMs}),workersStop=Promise.resolve().then(()=>pipeline.stop({timeoutMs})),closing=close();
    // Keep the actual stop promise live if a remote control call ignores its
    // deadline. No restart, pool close, lease expiry or optimistic success.
    let begun=false;try{await drain.begin({actorId,reasonHash});begun=true;}catch{}
    const [a,b]=await Promise.allSettled([httpStop,workersStop]);await closing;
    if(transition)await transition.catch(()=>{});
    const cleaned=cleanup?await cleanup:null;
    if(refresh)await refresh.catch(()=>{});
    let global=null;try{global=await drain.status();}catch{}
    const drained=begun&&a.status==='fulfilled'&&a.value.drained===true&&b.status==='fulfilled'&&b.value.drained===true&&(!cleaned||cleaned.slice(0,2).every(v=>v.status==='fulfilled'&&v.value.drained===true))&&global?.state==='DRAINED'&&global.inFlight===0;
    state=drained?'STOPPED':'FAILED';invalidate();return Object.freeze({drained,state});
  };
  const stop=({actorId,reasonHash,timeoutMs=5000}={})=>{
    if(typeof actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(actorId)||typeof reasonHash!=='string'||!/^[a-f0-9]{64}$/.test(reasonHash)||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw new Error('PROCESSING_SERVICE_CONFIGURATION_INVALID');
    if(!shutdown){state='STOPPING';invalidate();clearTimeout(timer);controller?.abort();shutdown=Promise.resolve().then(()=>executeStop({actorId,reasonHash,timeoutMs}));}
    let deadline;return Promise.race([shutdown,new Promise(resolve=>{deadline=setTimeout(()=>{state='STOP_TIMEOUT';invalidate();resolve(Object.freeze({drained:false,state}));},timeoutMs);})]).finally(()=>clearTimeout(deadline));
  };
  return Object.freeze({server:api.server,
    status:()=>Object.freeze({state,inFlight:api.status().inFlight,canaryInFlight:refresh!==null}),
    async start({port,host='127.0.0.1',actorId,timeoutMs=10000}={}){
      if(!Number.isInteger(port)||port<0||port>65535||typeof host!=='string'||!host||host.length>255||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw new Error('PROCESSING_SERVICE_CONFIGURATION_INVALID');
      if(transition||shutdown||!['IDLE','STOPPED'].includes(state))throw new Error('PROCESSING_SERVICE_ALREADY_ACTIVE');
      state='STARTING';invalidate();controller=new AbortController();
      const task=Promise.resolve().then(async()=>{
        const check=()=>{if(state!=='STARTING'||controller.signal.aborted)throw new Error('PROCESSING_SERVICE_START_ABORTED');};
        check();const s=await drain.status();check();if(s.state==='DRAINED'){await drain.resume({actorId});check();}else if(s.state!=='ACTIVE')throw new Error('PROCESSING_SERVICE_DRAIN_UNVERIFIED');
        api.resume();await pipeline.start({signal:controller.signal});check();await listen({port,host});check();state='RUNNING';invalidate();launch();return Object.freeze({state});
      });transition=task;
      task.finally(()=>{if(transition===task)transition=null;}).catch(()=>{});
      let deadline;
      try{return await Promise.race([task,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('PROCESSING_SERVICE_START_TIMEOUT')),timeoutMs);})]);}
      catch(error){if(state==='STARTING')state=error.message==='PROCESSING_SERVICE_START_TIMEOUT'?'START_TIMEOUT':'FAILED';invalidate();controller.abort();
        // Cleanup remains tracked by stop; start failure cannot close pools or
        // erase an unresolved startup callback. Deployment must call stop.
        cleanup=Promise.allSettled([api.stop(),Promise.resolve().then(()=>pipeline.stop()),close()]);
        throw new Error(error.message==='PROCESSING_SERVICE_START_TIMEOUT'?error.message:'PROCESSING_SERVICE_START_FAILED');}
      finally{clearTimeout(deadline);}
    },
    stop,
    // Explicit resume never discards a failed/uncertain stop. A fully stopped
    // service can be reconstructed with reconciled adapters by deployment.
    readiness,
  });
}
