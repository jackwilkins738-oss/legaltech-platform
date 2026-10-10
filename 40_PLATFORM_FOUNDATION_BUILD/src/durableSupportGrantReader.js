import {pinSupportSession,pinSupportFields} from './supportAuthorityInput.js';
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
  #readCurrent;#session;#timeoutMs;#maxConcurrent;#outstanding=new Set();
  constructor({readCurrent,liveSession,timeoutMs=3000,maxConcurrent=4}={}){
    if(typeof readCurrent!=='function'||typeof liveSession?.assertCurrent!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16)throw new Error('DURABLE_SUPPORT_GRANT_CONFIGURATION_INVALID');
    this.#readCurrent=readCurrent;this.#session=liveSession;this.#timeoutMs=timeoutMs;this.#maxConcurrent=maxConcurrent;
  }
  async assertCurrent(session,input={}){
    const {requestId,matterId,scope,documentRefHash=null,signal}=pinSupportFields(input,['requestId','matterId','scope'],['documentRefHash','signal'],denied);
    session=pinSupportSession(session,denied);
    if(!uuid(requestId)||!uuid(matterId)||!SCOPES.has(scope)||
      (scope==='DOCUMENT_READ'?!(typeof documentRefHash==='string'&&/^[a-f0-9]{64}$/.test(documentRefHash)):documentRefHash!==null)||signal?.aborted)throw denied();
    try{
      if(await this.#session.assertCurrent(session,{signal})!==true)throw denied();
      if(signal?.aborted)throw denied();
      if(this.#outstanding.size>=this.#maxConcurrent)throw denied();
      const controller=new AbortController();
      let timer,onAbort;
      const deadline=new Promise((_,reject)=>{
        onAbort=()=>{controller.abort();reject(denied());};
        if(signal)signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(onAbort,this.#timeoutMs);
      });
      const token={};this.#outstanding.add(token);
      const lookup=Promise.resolve().then(()=>{
        if(controller.signal.aborted)throw denied();
        return this.#readCurrent(Object.freeze({
          tenantId:session.tenantId,actorId:session.actorId,requestId,matterId,scope,documentRefHash,signal:controller.signal
        }));
      });
      void lookup.then(()=>this.#outstanding.delete(token),()=>this.#outstanding.delete(token));
      let decision;
      try{decision=await Promise.race([lookup,deadline]);}
      finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',onAbort);controller.abort();}
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
