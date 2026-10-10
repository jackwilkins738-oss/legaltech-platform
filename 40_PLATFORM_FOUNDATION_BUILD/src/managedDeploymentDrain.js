import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOKEN=/^[A-Za-z0-9_-]{16,128}$/;
const registered=new WeakSet();
const fail=()=>new Error('MANAGED_DRAIN_UNVERIFIED');
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));
function lease(v){if(!exact(v,['token','generation'])||!TOKEN.test(v.token??'')||!Number.isSafeInteger(v.generation)||v.generation<1)throw fail();return Object.freeze({...v});}
function status(v){if(!exact(v,['state','generation','inFlight','acceptingNew'])||!['ACTIVE','DRAINING','DRAINED'].includes(v.state)||!Number.isSafeInteger(v.generation)||v.generation<1||!Number.isSafeInteger(v.inFlight)||v.inFlight<0||v.acceptingNew!==(v.state==='ACTIVE')||(v.state==='DRAINED'&&v.inFlight!==0))throw fail();return Object.freeze({...v});}

// The backend must serialize acquire/begin/resume and retain leases durably.
// Deadlines never expire effects. Unknown outcomes require operation lookup;
// neither elapsed time nor a locally empty map proves a deployment drained.
export class ManagedDeploymentDrain {
  #backend;#authorize;#deployment;#held=new Map();#uncertain=new Map();#busy=new Set();
  constructor({backend,authorize,deploymentId}={}){
    if(!ID.test(deploymentId??'')||typeof authorize!=='function'||['acquire','release','status','begin','resume','lookupOperation'].some(k=>typeof backend?.[k]!=='function'))throw new Error('MANAGED_DRAIN_CONFIGURATION_INVALID');
    this.#backend=Object.freeze(Object.fromEntries(['acquire','release','status','begin','resume','lookupOperation'].map(k=>[k,backend[k].bind(backend)])));
    this.#authorize=authorize;this.#deployment=deploymentId;registered.add(this);
  }
  async #auth(phase,operationId=null,signal){if(signal?.aborted)throw fail();let ok=false;try{ok=await this.#authorize(Object.freeze({phase,deploymentId:this.#deployment,operationId,signal}));}catch{throw fail();}if(ok!==true||signal?.aborted)throw fail();}
  async acquire({kind,operationId,signal}={}){
    if(!['INGRESS','BACKGROUND','SIDE_EFFECT'].includes(kind)||!ID.test(operationId??''))throw fail();
    if([...this.#uncertain.keys()].some(k=>!this.#busy.has(k))||this.#held.has(operationId)||this.#busy.has(operationId))throw fail();
    this.#busy.add(operationId);
    try{await this.#auth('ACQUIRE',operationId,signal);this.#uncertain.set(operationId,null);
      const result=lease(await this.#backend.acquire({deploymentId:this.#deployment,kind,operationId,signal}));
      if([...this.#held.values()].some(v=>v.token===result.token))throw fail();
      this.#held.set(operationId,result);this.#uncertain.delete(operationId);
      // Even if an abort raced acquisition, return the lease to its owner for
      // release. The owner must check its signal before beginning any effect.
      return result;
    }catch{throw fail();}finally{this.#busy.delete(operationId);}
  }
  async release(value){
    const supplied=lease(value),entry=[...this.#held].find(([,v])=>v.token===supplied.token&&v.generation===supplied.generation);
    if(!entry||this.#busy.has(entry[0]))throw fail();const [operationId]=entry;this.#busy.add(operationId);
    try{await this.#auth('RELEASE',operationId);this.#uncertain.set(operationId,supplied);
      await this.#release(operationId,supplied);this.#held.delete(operationId);this.#uncertain.delete(operationId);
    }catch{this.#uncertain.set(operationId,supplied);throw fail();}finally{this.#busy.delete(operationId);}
  }
  async #release(operationId,value){const ack=await this.#backend.release({deploymentId:this.#deployment,operationId,lease:value});
    if(!exact(ack,['released','token','generation'])||ack.released!==true||ack.token!==value.token||ack.generation!==value.generation)throw fail();}
  async status(){await this.#auth('STATUS');if(this.#uncertain.size)throw fail();const result=status(await this.#backend.status({deploymentId:this.#deployment}));
    if(this.#uncertain.size||result.inFlight<this.#held.size||[...this.#held.values()].some(v=>v.generation>result.generation))throw fail();return result;}
  async probe(){try{const s=await this.status();return Object.freeze({ok:s.acceptingNew,code:s.acceptingNew?'MANAGED_DRAIN_ACTIVE':'MANAGED_DRAIN_CLOSED'});}catch{return Object.freeze({ok:false,code:'MANAGED_DRAIN_UNVERIFIED'});}}
  async begin({actorId,reasonHash}={}){
    if(!ID.test(actorId??'')||!/^[a-f0-9]{64}$/.test(reasonHash??''))throw fail();await this.#auth('BEGIN',actorId);
    const operationId=`drain-begin:${crypto.randomUUID()}`;this.#uncertain.set(operationId,null);
    try{const result=status(await this.#backend.begin({deploymentId:this.#deployment,operationId,actorId,reasonHash}));if(result.state==='ACTIVE')throw fail();this.#uncertain.delete(operationId);return result;}catch{throw fail();}
  }
  async resume({actorId}={}){
    if(!ID.test(actorId??'')||this.#uncertain.size||this.#held.size||this.#busy.size)throw fail();await this.#auth('RESUME',actorId);
    const prior=await this.status();if(prior.state!=='DRAINED'||prior.inFlight!==0)throw fail();
    const operationId=`drain-resume:${crypto.randomUUID()}`;this.#uncertain.set(operationId,null);
    try{const result=status(await this.#backend.resume({deploymentId:this.#deployment,operationId,actorId,expectedGeneration:prior.generation}));
      if(result.state!=='ACTIVE'||result.generation<=prior.generation||result.inFlight!==0)throw fail();this.#uncertain.delete(operationId);return result;}catch{throw fail();}
  }
  // Only acquisition/release uncertainty is reconcilable here. Control-plane
  // begin/resume ambiguity needs an operator to reconcile the backend itself.
  async reconcile({operationId}={}){
    if(!ID.test(operationId??'')||!this.#uncertain.has(operationId)||this.#busy.has(operationId)||/^drain-(begin|resume):/.test(operationId))throw fail();
    this.#busy.add(operationId);try{await this.#auth('RECONCILE',operationId);
      const proof=await this.#backend.lookupOperation({deploymentId:this.#deployment,operationId});
      if(!exact(proof,['state','lease'])||!['ABSENT','HELD','RELEASED'].includes(proof.state))throw fail();
      if(proof.state==='ABSENT'){if(proof.lease!==null||this.#held.has(operationId))throw fail();}
      else{const found=lease(proof.lease),known=this.#held.get(operationId);if(known&&(known.token!==found.token||known.generation!==found.generation))throw fail();
        if(proof.state==='HELD')await this.#release(operationId,found);}
      this.#held.delete(operationId);this.#uncertain.delete(operationId);return Object.freeze({reconciled:true});
    }catch{throw fail();}finally{this.#busy.delete(operationId);}
  }
}
export const isManagedDeploymentDrain=value=>registered.has(value);
