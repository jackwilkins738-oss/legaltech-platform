import {ManagedDeploymentDrain,isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {createPostgresManagedProcessing} from './postgresManagedProcessing.js';
import {createProcessingHttp} from './processingHttp.js';
import {REQUIRED_PRODUCTION_PROBES} from './productionAdmission.js';

// Deployment supplies provider implementations and principals; this root binds
// the same shared drain to HTTP, relay, workers and mandatory readiness.
export function createPostgresProcessingService({processing,drain:drainOptions,http,probes,readiness:readinessOptions,canaryIntervalMs=10000}={}){
  const drain=new ManagedDeploymentDrain(drainOptions);
  if(!processing?.domain||!processing?.worker||Object.hasOwn(processing.domain,'drain')||Object.hasOwn(processing.worker,'drain'))throw new Error('PROCESSING_SERVICE_DRAIN_OVERRIDE_FORBIDDEN');
  const age=processing.canary?.maxAgeMs??30000;
  if(!Number.isInteger(canaryIntervalMs)||canaryIntervalMs<100||canaryIntervalMs>age/2)throw new Error('PROCESSING_SERVICE_CONFIGURATION_INVALID');
  const pipeline=createPostgresManagedProcessing({...processing,domain:{...processing.domain,drain},worker:{...processing.worker,drain}});
  if(!probes||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length||REQUIRED_PRODUCTION_PROBES.some(k=>typeof Object.getOwnPropertyDescriptor(probes,k)?.value!=='function'))throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
  const original=probes.DEPLOYMENT_DRAIN;
  const readiness=pipeline.createReadiness({...readinessOptions,probes:{...probes,DEPLOYMENT_DRAIN:async({signal})=>{
    if(signal?.aborted||(await original({signal}))?.ok!==true)return {ok:false,code:'MANAGED_DRAIN_UNVERIFIED'};const result=await drain.probe();return signal?.aborted?{ok:false,code:'MANAGED_DRAIN_UNVERIFIED'}:result;
  }}});
  return createProcessingService({pipeline,drain,readiness,http,canaryIntervalMs});
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
