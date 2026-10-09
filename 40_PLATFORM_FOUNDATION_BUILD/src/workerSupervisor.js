import {OutboxRelaySupervisor} from './outboxRelaySupervisor.js';
const kinds=['PROCESS_INBOUND','POLICY_EVALUATION'];
// Reuse admission, non-overlap and actual-settlement drain semantics. No timer
// starts during construction. Fairness persists across cycles and tenants.
export class WorkerSupervisor {
  #host;
  constructor({runtime,getScopes,authorizeScope,drain,pollIntervalMs=1000,cycleTimeoutMs=60000,maxScopes=100,batchSize=25,recoveryLimit=25}={}) {
    if(typeof runtime?.processNext!=='function'||typeof runtime?.recoverExpired!=='function'||!Number.isInteger(recoveryLimit)||recoveryLimit<1||recoveryLimit>100)throw new Error('WORKER_SUPERVISOR_CONFIGURATION_INVALID');
    const process=runtime.processNext.bind(runtime),recover=runtime.recoverExpired.bind(runtime);let next=0;
    const adapter={async relay({tenantId,actorId,limit,signal}){
      for(const kind of kinds){if(signal.aborted)throw new Error('WORKER_CYCLE_ABORTED');await recover({tenantId,kind,limit:recoveryLimit,signal});}
      let processed=0,empty=0;
      while(processed<limit&&empty<kinds.length){
        if(signal.aborted)throw new Error('WORKER_CYCLE_ABORTED');
        const kind=kinds[next];next=(next+1)%kinds.length;
        const result=await process({tenantId,serviceActorId:actorId,kind,signal});
        if(result===null){empty++;continue;}empty=0;
        if(!['SUCCEEDED','FAILED'].includes(result?.status))throw new Error('WORKER_CYCLE_UNSETTLED');processed++;
      }
      return {ok:true,scanned:processed,delivered:processed};
    }};
    this.#host=new OutboxRelaySupervisor({relay:adapter,getScopes,authorizeScope,drain,pollIntervalMs,cycleTimeoutMs,maxScopes,batchSize,operation:'WORKER_EXECUTION_CYCLE'});
  }
  status(){const {delivered,errorCode,...value}=this.#host.status();return Object.freeze({...value,processed:delivered,errorCode:errorCode?.replace('OUTBOX_RELAY','WORKER_EXECUTION')??null});}
  start(options){this.#host.start(options);return this.status();}
  stop(options){return this.#host.stop(options);}
  async probe(){const result=await this.#host.probe();return Object.freeze({ok:result.ok,code:result.ok?'WORKER_EXECUTION_RUNNING':'WORKER_EXECUTION_NOT_READY'});}
}
