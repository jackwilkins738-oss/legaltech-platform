// V143 foundation: a fail-closed, async live-session authorization boundary.
// This is not a grant registry and must not be used as a substitute for durable
// database transaction fencing, row-level security, or end-of-read checks.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function validId(value){return typeof value==='string'&&UUID.test(value);}
function validProof(proof,session){
  if(!proof||Object.getPrototypeOf(proof)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(proof);
  if(keys.length!==5||!['tenantId','actorId','sessionId','active','stepUpValid'].every(k=>Object.hasOwn(proof,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(proof,k),'value')))return false;
  return proof.tenantId===session.tenantId&&proof.actorId===session.actorId&&proof.sessionId===session.sessionId&&proof.active===true&&proof.stepUpValid===true;
}
export class LiveSupportSessionBoundary {
  #check;
  constructor({check}={}){
    if(typeof check!=='function')throw new Error('LIVE_SUPPORT_SESSION_CONFIGURATION_INVALID');
    this.#check=check;
  }
  async assertCurrent(session,{signal}={}){
    if(!session||Object.getPrototypeOf(session)!==Object.prototype||!['tenantId','actorId','sessionId'].every(k=>Object.hasOwn(session,k)&&validId(Object.getOwnPropertyDescriptor(session,k)?.value)))throw new Error('LIVE_SUPPORT_SESSION_UNAVAILABLE');
    if(signal?.aborted)throw new Error('LIVE_SUPPORT_SESSION_UNAVAILABLE');
    let proof;
    try{
      proof=await this.#check(Object.freeze({tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,signal}));
    }catch{throw new Error('LIVE_SUPPORT_SESSION_UNAVAILABLE');}
    if(signal?.aborted||!validProof(proof,session))throw new Error('LIVE_SUPPORT_SESSION_UNAVAILABLE');
    return true;
  }
}
