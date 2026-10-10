// V144: fail-closed, bounded live session proof. This is NOT durable grant authority.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const denied=()=>new Error('LIVE_SUPPORT_SESSION_UNAVAILABLE');
function validId(value){return typeof value==='string'&&UUID.test(value);}
function validProof(proof,session){
  if(!proof||Object.getPrototypeOf(proof)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(proof);
  if(keys.length!==5||!['tenantId','actorId','sessionId','active','stepUpValid'].every(k=>Object.hasOwn(proof,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(proof,k),'value')))return false;
  return proof.tenantId===session.tenantId&&proof.actorId===session.actorId&&proof.sessionId===session.sessionId&&proof.active===true&&proof.stepUpValid===true;
}
export class LiveSupportSessionBoundary {
  #check;#timeoutMs;#maxConcurrent;#outstanding=new Set();
  constructor({check,timeoutMs=3000,maxConcurrent=4}={}){
    if(typeof check!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16)throw new Error('LIVE_SUPPORT_SESSION_CONFIGURATION_INVALID');
    this.#check=check;this.#timeoutMs=timeoutMs;this.#maxConcurrent=maxConcurrent;
  }
  async assertCurrent(session,{signal}={}){
    if(!session||Object.getPrototypeOf(session)!==Object.prototype||!['tenantId','actorId','sessionId'].every(k=>Object.hasOwn(session,k)&&validId(Object.getOwnPropertyDescriptor(session,k)?.value)))throw denied();
    if(signal?.aborted||this.#outstanding.size>=this.#maxConcurrent)throw denied();
    const controller=new AbortController();
    let timer,onAbort;
    const stopped=new Promise((_,reject)=>{
      onAbort=()=>{controller.abort();reject(denied());};
      if(signal)signal.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(onAbort,this.#timeoutMs);
    });
    try{
      if(signal?.aborted)throw denied();
      // Promise.resolve().then() catches synchronous provider throws and consumes late rejection.
      const token={};
      this.#outstanding.add(token);
      const check=Promise.resolve().then(()=>{
        if(controller.signal.aborted)throw denied();
        return this.#check(Object.freeze({
          tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,signal:controller.signal
        }));
      });
      // Keep budget owned until the provider ACTUALLY settles, not merely until
      // our timeout returns. Aborted but stuck providers must not be replaced.
      void check.then(()=>this.#outstanding.delete(token),()=>this.#outstanding.delete(token));
      const proof=await Promise.race([check,stopped]);
      if(controller.signal.aborted||signal?.aborted||!validProof(proof,session))throw denied();
      return true;
    }catch{throw denied();}
    finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',onAbort);controller.abort();}
  }
}
