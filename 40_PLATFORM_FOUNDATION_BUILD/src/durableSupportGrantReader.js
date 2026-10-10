// V146 reference: fail-closed tenant-bound read of durable support grant rows.
// readCurrent must use a tenant-scoped RLS-enforced PostgreSQL transaction.
// This module never caches authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES=new Set(['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']);
const denied=()=>new Error('DURABLE_SUPPORT_GRANT_UNAVAILABLE');
function uuid(value){return typeof value==='string'&&UUID.test(value);}
function own(row,key){return Object.hasOwn(row,key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(row,key),'value');}
function plain(row){return row!==null&&typeof row==='object'&&Object.getPrototypeOf(row)===Object.prototype;}
export class DurableSupportGrantReader{
  #readCurrent;#session;
  constructor({readCurrent,liveSession}={}){
    if(typeof readCurrent!=='function'||typeof liveSession?.assertCurrent!=='function')throw new Error('DURABLE_SUPPORT_GRANT_CONFIGURATION_INVALID');
    this.#readCurrent=readCurrent;this.#session=liveSession;
  }
  async assertCurrent(session,{requestId,matterId,scope,documentRefHash=null,signal}={}){
    if(!plain(session)||!['tenantId','actorId','sessionId'].every(k=>own(session,k)&&uuid(session[k]))||
      !uuid(requestId)||!uuid(matterId)||!SCOPES.has(scope)||
      (scope==='DOCUMENT_READ'?!/^[a-f0-9]{64}$/.test(documentRefHash??''):documentRefHash!==null)||signal?.aborted)throw denied();
    try{
      if(await this.#session.assertCurrent(session,{signal})!==true)throw denied();
      if(signal?.aborted)throw denied();
      const decision=await this.#readCurrent(Object.freeze({
        tenantId:session.tenantId,actorId:session.actorId,requestId,matterId,scope,documentRefHash,signal
      }));
      if(signal?.aborted||!plain(decision)||Reflect.ownKeys(decision).length!==7||
        !['tenantId','actorId','requestId','matterId','scope','documentRefHash','active'].every(k=>own(decision,k))||
        decision.tenantId!==session.tenantId||decision.actorId!==session.actorId||
        decision.requestId!==requestId||decision.matterId!==matterId||
        decision.scope!==scope||decision.documentRefHash!==documentRefHash||
        decision.active!==true)throw denied();
      if(await this.#session.assertCurrent(session,{signal})!==true)throw denied();
      if(signal?.aborted)throw denied();
      return true;
    }catch{throw denied();}
  }
}
