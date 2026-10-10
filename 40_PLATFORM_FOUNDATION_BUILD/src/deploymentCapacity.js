// Deployment evidence only: the budget is operator supplied, not a discovered
// provider entitlement. Pool credentials, endpoints and tenant data stay private.
const BASE=['DOMAIN','RELAY','PRODUCER','WORKER','DOMAIN_READER','QUEUE_READER','DRAIN_WORKER','DRAIN_OPERATOR','DRAIN_READER'];
const GRAPH=['GRAPH_PRODUCER','GRAPH_WORKER','GRAPH_READER'];
const NAMES=new Set([...BASE,...GRAPH,'REVIEW','REVIEW_READER']);
const registered=new WeakSet();
const fail=()=>new Error('DEPLOYMENT_CAPACITY_CONFIGURATION_INVALID');
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw fail();return value;}
function record(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length
    ||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw fail();
  return value;
}
function dense(value,min,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<min||value.length>max
    ||Reflect.ownKeys(value).length!==value.length+1)throw fail();
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i))??{},'value'))throw fail();
  return value;
}
function profile(value){
  record(value,['connectionLimit','reservedConnections','maxConcurrentReplicas','maxWaitingPerPool']);
  return Object.freeze({connectionLimit:integer(value.connectionLimit,1,100000),reservedConnections:integer(value.reservedConnections,1,100000),
    maxConcurrentReplicas:integer(value.maxConcurrentReplicas,1,1000),maxWaitingPerPool:integer(value.maxWaitingPerPool,0,1000)});
}
function poolPlan(value){
  record(value,['name','max','connectionTimeoutMillis']);
  if(!NAMES.has(value.name))throw fail();
  return Object.freeze({name:value.name,max:integer(value.max,1,10000),connectionTimeoutMillis:integer(value.connectionTimeoutMillis,100,10000)});
}
export function validateConnectionPlan(value){
  record(value,['profile','pools']);
  const config=profile(value.profile);
  dense(value.pools,9,14);
  const pools=Object.freeze(value.pools.map(poolPlan)),names=new Set(pools.map(p=>p.name));
  if(names.size!==pools.length||BASE.some(n=>!names.has(n))||GRAPH.some(n=>names.has(n))&&!GRAPH.every(n=>names.has(n)))throw fail();
  const perReplica=pools.reduce((n,p)=>n+p.max,0),fleetConnections=perReplica*config.maxConcurrentReplicas;
  if(fleetConnections+config.reservedConnections>config.connectionLimit)throw new Error('DEPLOYMENT_CAPACITY_BUDGET_EXCEEDED');
  return Object.freeze({profile:config,pools,perReplica,fleetConnections,headroom:config.connectionLimit-config.reservedConnections-fleetConnections});
}
function options(pool){
  const descriptor=Object.getOwnPropertyDescriptor(pool,'options');
  if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.value||typeof descriptor.value!=='object')throw fail();
  const opts=descriptor.value;
  for(const key of ['max','connectionTimeoutMillis'])if(!Object.hasOwn(Object.getOwnPropertyDescriptor(opts,key)??{},'value'))throw fail();
  return opts;
}
export const isDeploymentCapacity=value=>registered.has(value);
export function bindDeploymentCapacityService(service,deploymentCapacity){
  if(!isDeploymentCapacity(deploymentCapacity)||['start','stop','status'].some(k=>typeof service?.[k]!=='function'))throw fail();
  return Object.freeze({...service,deploymentCapacity,
    status:()=>Object.freeze({...service.status(),capacityProbeInFlight:deploymentCapacity.status().probeInFlight}),
    async start(args){
      const capacityState=deploymentCapacity.status();
      if(!capacityState.healthy||capacityState.probeInFlight)throw new Error('DEPLOYMENT_CAPACITY_UNVERIFIED');
      return service.start(args);
    },
    async stop(args){
      const result=await service.stop(args);
      return Object.freeze({...result,drained:result.drained===true&&!deploymentCapacity.status().probeInFlight});
    },
  });
}
export class DeploymentCapacity {
  #plan;#bindings;#busy=false;#uncertain=false;
  constructor({profile:config,bindings}={}){
    dense(bindings,9,14);
    const seen=new Set();
    this.#bindings=Object.freeze(bindings.map(value=>{
      record(value,['name','pool']);
      if(!value.pool||typeof value.pool.connect!=='function'||seen.has(value.pool))throw fail();
      seen.add(value.pool);const opts=options(value.pool);
      return Object.freeze({name:value.name,pool:value.pool,options:opts,max:opts.max,connectionTimeoutMillis:opts.connectionTimeoutMillis});
    }));
    this.#plan=validateConnectionPlan({profile:config,pools:this.#bindings.map(({name,max,connectionTimeoutMillis})=>({name,max,connectionTimeoutMillis}))});
    if(!this.#inspect())throw fail();registered.add(this);Object.freeze(this);
  }
  #inspect(){
    try{
      for(const binding of this.#bindings){
        const opts=options(binding.pool);
        if(opts!==binding.options||opts.max!==binding.max||opts.connectionTimeoutMillis!==binding.connectionTimeoutMillis){this.#uncertain=true;return false;}
        const {totalCount,idleCount,waitingCount}=binding.pool;
        if(![totalCount,idleCount,waitingCount].every(n=>Number.isSafeInteger(n)&&n>=0)||totalCount>binding.max||idleCount>totalCount){this.#uncertain=true;return false;}
        if(waitingCount>this.#plan.profile.maxWaitingPerPool)return false;
      }
      return !this.#uncertain;
    }catch{this.#uncertain=true;return false;}
  }
  status(){
    const healthy=this.#inspect();
    return Object.freeze({healthy,uncertain:this.#uncertain,probeInFlight:this.#busy,poolCount:this.#bindings.length,
      perReplica:this.#plan.perReplica,fleetConnections:this.#plan.fleetConnections,headroom:this.#plan.headroom});
  }
  // Keep ownership until the caller's actual database probe settles. Cancellation
  // never makes a second probe admissible or proves that provider work stopped.
  async probe(original,{signal}={}){
    if(typeof original!=='function'||signal?.aborted||this.#busy||!this.#inspect())return Object.freeze({ok:false,code:'DEPLOYMENT_CAPACITY_UNVERIFIED'});
    this.#busy=true;
    try{
      const result=await original({signal});
      const capacityOk=this.#inspect();
      const keys=result&&typeof result==='object'?Reflect.ownKeys(result):[];
      const valid=result===true||result&&Object.getPrototypeOf(result)===Object.prototype&&keys.every(k=>['ok','code'].includes(k))
        &&Object.getOwnPropertyDescriptor(result,'ok')?.value===true
        &&(!Object.hasOwn(result,'code')||typeof Object.getOwnPropertyDescriptor(result,'code')?.value==='string'&&/^[A-Z0-9_.:-]{1,64}$/.test(result.code));
      return Object.freeze({ok:!signal?.aborted&&capacityOk&&valid===true,code:!signal?.aborted&&capacityOk&&valid===true?'DEPLOYMENT_CAPACITY_VERIFIED':'DEPLOYMENT_CAPACITY_UNVERIFIED'});
    }catch{return Object.freeze({ok:false,code:'DEPLOYMENT_CAPACITY_UNVERIFIED'});}
    finally{this.#busy=false;}
  }
}
