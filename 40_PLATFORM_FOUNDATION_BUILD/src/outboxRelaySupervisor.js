import crypto from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw new Error('RELAY_SUPERVISOR_CONFIGURATION_INVALID');return v;}
function scopes(values,max){
  if(!Array.isArray(values)||values.length>max)throw new Error('RELAY_SCOPES_INVALID');
  const result=values.map(value=>{
    if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==2||typeof value.tenantId!=='string'||typeof value.actorId!=='string'||!UUID.test(value.tenantId)||!UUID.test(value.actorId))throw new Error('RELAY_SCOPES_INVALID');
    return Object.freeze({tenantId:value.tenantId.toLowerCase(),actorId:value.actorId.toLowerCase()});
  });
  if(new Set(result.map(v=>v.tenantId)).size!==result.length)throw new Error('RELAY_SCOPES_INVALID');return result;
}
// One cycle at a time. A deadline aborts actual effects but never assumes that
// an uncooperative dependency stopped. Restart is forbidden while it is live.
export class OutboxRelaySupervisor {
  #relay;#getScopes;#authorize;#drain;#interval;#deadline;#maxScopes;#limit;
  #state='IDLE';#timer=null;#cycle=null;#controller=null;#externalSignal=null;#externalAbort=null;
  #lastError=null;#cycles=0;#delivered=0;#lastSuccess=null;
  #unreleasedLease=false;
  constructor({relay,getScopes,authorizeScope,drain,pollIntervalMs=1000,cycleTimeoutMs=30000,maxScopes=100,batchSize=25}={}) {
    if(typeof relay?.relay!=='function'||typeof getScopes!=='function'||typeof authorizeScope!=='function'||typeof drain?.acquire!=='function'||typeof drain?.release!=='function')throw new Error('RELAY_SUPERVISOR_CONFIGURATION_INVALID');
    this.#relay=Object.freeze({relay:relay.relay.bind(relay)});this.#getScopes=getScopes;this.#authorize=authorizeScope;
    this.#drain=Object.freeze({acquire:drain.acquire.bind(drain),release:drain.release.bind(drain)});
    this.#interval=integer(pollIntervalMs,100,60000);this.#deadline=integer(cycleTimeoutMs,100,60000);this.#maxScopes=integer(maxScopes,1,1000);this.#limit=integer(batchSize,1,100);
  }
  status(){return Object.freeze({state:this.#state,inFlight:this.#cycle!==null,cycles:this.#cycles,delivered:this.#delivered,lastSuccessAt:this.#lastSuccess,errorCode:this.#lastError});}
  async probe(){const s=this.status();return Object.freeze({ok:s.state==='RUNNING'&&s.lastSuccessAt!==null&&s.errorCode===null,code:s.state==='RUNNING'&&s.lastSuccessAt!==null&&s.errorCode===null?'OUTBOX_RELAY_RUNNING':'OUTBOX_RELAY_NOT_READY'});}
  #detach(){this.#externalSignal?.removeEventListener('abort',this.#externalAbort);this.#externalSignal=null;this.#externalAbort=null;}
  #stop(){
    clearTimeout(this.#timer);this.#timer=null;
    if(!['IDLE','STOPPED'].includes(this.#state))this.#state='STOPPING';
    this.#controller?.abort();this.#detach();
    if(!this.#cycle)this.#state='STOPPED';
  }
  start({signal}={}) {
    if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'))throw new Error('RELAY_SUPERVISOR_CONFIGURATION_INVALID');
    if(this.#cycle||this.#unreleasedLease||!['IDLE','STOPPED','FAILED'].includes(this.#state))throw new Error('RELAY_SUPERVISOR_ALREADY_ACTIVE');
    if(signal?.aborted)throw new Error('RELAY_SUPERVISOR_ABORTED');
    this.#detach();this.#state='RUNNING';this.#lastError=null;this.#lastSuccess=null;
    if(signal){this.#externalSignal=signal;this.#externalAbort=()=>this.#stop();signal.addEventListener('abort',this.#externalAbort,{once:true});}
    this.#launch();return this.status();
  }
  #launch(){
    if(this.#state!=='RUNNING'||this.#cycle)return;
    const controller=new AbortController();this.#controller=controller;
    // Schedule after the promise is stored, so reentrant shutdown is safe.
    const task=Promise.resolve().then(()=>this.#run(controller));this.#cycle=task;
    task.finally(()=>{
      if(this.#cycle!==task)return;
      this.#cycle=null;this.#controller=null;
      if(['STOPPING','STOP_TIMEOUT'].includes(this.#state))this.#state='STOPPED';
      if(this.#state==='RUNNING')this.#timer=setTimeout(()=>{this.#timer=null;this.#launch();},this.#interval);
      else this.#detach();
    }).catch(()=>{});
  }
  async #run(controller){
    let lease,delivered=0;
    const signal=controller.signal;
    const check=()=>{if(signal.aborted||this.#state!=='RUNNING')throw new Error('RELAY_CYCLE_ABORTED');};
    const timer=setTimeout(()=>{if(this.#state==='RUNNING'){this.#state='FAILED';this.#lastError='OUTBOX_RELAY_CYCLE_TIMEOUT';}controller.abort();},this.#deadline);
    try{
      check();
      // A failed acquisition may have created a remote lease before its reply
      // was lost. Only a returned lease and successful release reconcile it.
      this.#unreleasedLease=true;
      lease=await this.#drain.acquire({kind:'BACKGROUND',operationId:`outbox-relay:${crypto.randomUUID()}`,signal});
      if(!lease||typeof lease.token!=='string'||lease.token.length<1||lease.token.length>256||!Number.isSafeInteger(lease.generation)||lease.generation<1)throw new Error('RELAY_DRAIN_INVALID');
      check();
      const current=scopes(await this.#getScopes(Object.freeze({signal})),this.#maxScopes);check();
      for(const scope of current){
        const allowed=await this.#authorize(Object.freeze({...scope,operation:'OUTBOX_RELAY_CYCLE',signal}));check();
        if(allowed!==true)throw new Error('RELAY_SCOPE_FORBIDDEN');
        const result=await this.#relay.relay({...scope,limit:this.#limit,signal});check();
        if(result?.ok!==true||!Number.isInteger(result.delivered)||!Number.isInteger(result.scanned)||result.delivered<0||result.delivered!==result.scanned||result.scanned>this.#limit)throw new Error('RELAY_RESULT_INVALID');
        delivered+=result.delivered;
      }
      check();
    }catch{
      // No dependency errors, tenant IDs, credentials or leases enter health.
      if(this.#state==='RUNNING'){this.#state='FAILED';this.#lastError='OUTBOX_RELAY_CYCLE_FAILED';}
      controller.abort();
    }finally{
      try{if(lease){await this.#drain.release(lease);this.#unreleasedLease=false;}}catch{this.#state='FAILED';this.#lastError='OUTBOX_RELAY_DRAIN_RELEASE_FAILED';controller.abort();}
      clearTimeout(timer);
    }
    if(this.#state==='RUNNING'&&!signal.aborted){this.#cycles++;this.#delivered+=delivered;this.#lastSuccess=new Date().toISOString();}
  }
  async stop({timeoutMs=5000}={}) {
    integer(timeoutMs,10,60000);this.#stop();const task=this.#cycle;
    if(!task)return Object.freeze({drained:!this.#unreleasedLease,state:this.#state});
    let timer;
    const settled=await Promise.race([task.then(()=>true,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);clearTimeout(timer);
    if(!settled&&this.#cycle){this.#state='STOP_TIMEOUT';this.#lastError='OUTBOX_RELAY_STOP_TIMEOUT';}
    return Object.freeze({drained:settled&&!this.#unreleasedLease,state:this.#state});
  }
}
