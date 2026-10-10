const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROLE=/^[a-z_][a-z0-9_]{0,62}$/;
function unavailable(){return new Error('POSTGRES_TRANSACTION_UNAVAILABLE');}

function pinContext(context){
  try{
    if(!context||Object.getPrototypeOf(context)!==Object.prototype)throw new Error();
    const pinned={};
    for(const key of ['tenantId','actorId']){
      const descriptor=Object.getOwnPropertyDescriptor(context,key);
      if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string'||!UUID.test(descriptor.value))throw new Error();
      pinned[key]=descriptor.value.toLowerCase();
    }
    return Object.freeze(pinned);
  }catch{throw new Error('POSTGRES_TRANSACTION_CONTEXT_INVALID');}
}

// Internal driver boundary. The callback is trusted server code, never client SQL.
// All statements stay on one checked-out connection; no pool.query inside a transaction.
export async function runPostgresTransaction({pool,expectedRole,timeoutMs=5000,context=null,readOnly=false,isolation='READ COMMITTED',signal},work) {
  if(typeof pool?.connect!=='function'||(typeof expectedRole!=='string'||!ROLE.test(expectedRole))||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||typeof work!=='function'||typeof readOnly!=='boolean'||!['READ COMMITTED','REPEATABLE READ'].includes(isolation)) throw new Error('POSTGRES_TRANSACTION_CONFIGURATION_INVALID');
  if(context!==null)context=pinContext(context);
  let client,released=false,closed=false,succeeded=false,pendingQueries=0,timer,releaseFailed=false,commitStarted=false;
  const controller=new AbortController();
  const release=destroy=>{if(client&&!released){released=true;try{client.release(destroy);}catch{releaseFailed=true;}}};
  let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject});
  const abort=()=>{if(closed)return;closed=true;controller.abort();release(true);rejectDeadline(unavailable());};
  const ensureOpen=()=>{if(closed||signal?.aborted)throw unavailable();};
  const rawQuery=async(...args)=>{ensureOpen();const result=await client.query(...args);ensureOpen();return result;};
  if(signal?.aborted) throw unavailable();
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(abort,timeoutMs);
  const operation=(async()=>{
    client=await pool.connect();
    if(closed||signal?.aborted){release(true);throw unavailable();}
    await rawQuery(isolation==='REPEATABLE READ'?`BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly?' READ ONLY':''}`:readOnly?'BEGIN READ ONLY':'BEGIN');
    await rawQuery("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",[`${timeoutMs}ms`,`${Math.min(timeoutMs,1000)}ms`]);
    await rawQuery('SET LOCAL row_security=on');
    const identity=await rawQuery("SELECT current_user AS effective_role,session_user AS login_role,NULLIF(current_setting('app.tenant_id',true),'') AS tenant_context,NULLIF(current_setting('app.actor_id',true),'') AS actor_context");
    if(identity.rows?.length!==1||identity.rows[0].effective_role!==expectedRole||identity.rows[0].login_role!==expectedRole
      ||identity.rows[0].tenant_context!==null||identity.rows[0].actor_context!==null)throw unavailable();
    if(context!==null)await rawQuery("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[context.tenantId.toLowerCase(),context.actorId.toLowerCase()]);
    let callbackActive=true;
    const query=(sql,values=[])=>{
      if(!callbackActive||closed||typeof sql!=='string'||!sql.trim()||!Array.isArray(values))return Promise.reject(unavailable());
      pendingQueries++;
      const result=rawQuery(sql,values);
      // Observe failures even if a faulty callback forgets to await its query.
      result.then(()=>{pendingQueries--},()=>{pendingQueries--});
      return result;
    };
    let value;
    try {value=await work(Object.freeze({query,signal:controller.signal}));}
    finally {callbackActive=false;}
    if(pendingQueries!==0)throw unavailable();
    ensureOpen();
    commitStarted=true;
    await rawQuery('COMMIT');
    const cleared=await rawQuery("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant_context,NULLIF(current_setting('app.actor_id',true),'') AS actor_context");
    if(cleared.rows?.length!==1||cleared.rows[0].tenant_context!==null||cleared.rows[0].actor_context!==null)throw unavailable();
    succeeded=true;
    return value;
  })();
  try {return await Promise.race([operation,deadline]);}
  catch {throw commitStarted?new Error('POSTGRES_TRANSACTION_OUTCOME_UNKNOWN'):unavailable();}
  finally {
    closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    // Disconnect on ANY failed/uncertain transaction, including an ambiguous COMMIT.
    // The driver must destroy that backend, never return it to another tenant.
    release(!succeeded);
    if(releaseFailed)throw commitStarted?new Error('POSTGRES_TRANSACTION_OUTCOME_UNKNOWN'):unavailable();
  }
}

export class PostgresTenantTransactions {
  #options;
  constructor({pool,expectedRole,timeoutMs=5000}={}) {
    if(typeof pool?.connect!=='function'||(typeof expectedRole!=='string'||!ROLE.test(expectedRole))||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw new Error('POSTGRES_TRANSACTION_CONFIGURATION_INVALID');
    this.#options={pool,expectedRole,timeoutMs};
  }
  async run(input={},work) {
    const context=pinContext(input);
    const {readOnly=false,signal}=input;
    return runPostgresTransaction({...this.#options,context,readOnly,signal},work);
  }
}
