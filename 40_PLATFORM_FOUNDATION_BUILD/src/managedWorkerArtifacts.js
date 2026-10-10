import crypto from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const fail=()=>new Error('WORKER_ARTIFACT_PROVIDER_UNAVAILABLE');
function data(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)throw fail();
  const d=Object.getOwnPropertyDescriptors(value);
  if(keys.some(k=>!Object.hasOwn(d[k]??{},'value')))throw fail();
  return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function signalCheck(signal){if(signal?.aborted)throw fail();}
const ownedArtifacts=new WeakMap();
// Only buffers created and transferred by this managed boundary are disposable.
// Legacy/provider-owned buffers remain untouched by the worker runtime.
export function releaseManagedArtifact(value){const bytes=ownedArtifacts.get(value);if(bytes){bytes.fill(0);ownedArtifacts.delete(value);}}
const fields=['tenantId','id','kind','hash','objectKey','versionId','size','state','evidenceHash','region','revision'];
export class ManagedWorkerArtifacts {
  #manifest;#storage;#authorize;#verify;#payloadLimit;#policyLimit;#reads=new Set();#maxReads;#readTimeout;#probePending=false;
  constructor({manifest,storage,authorizeVersion,verifyEvidence,maxPayloadBytes=15*1024*1024,maxPolicyBytes=1024*1024,maxConcurrentReads=4,readTimeoutMs=10000}={}){
    if(['resolveVersion','probe'].some(k=>typeof manifest?.[k]!=='function')||['readVersion','probe'].some(k=>typeof storage?.[k]!=='function')
      ||typeof authorizeVersion!=='function'||typeof verifyEvidence!=='function'||!Number.isSafeInteger(maxPayloadBytes)||maxPayloadBytes<1||maxPayloadBytes>15*1024*1024
      ||!Number.isSafeInteger(maxPolicyBytes)||maxPolicyBytes<1||maxPolicyBytes>1024*1024||!Number.isInteger(maxConcurrentReads)||maxConcurrentReads<1||maxConcurrentReads>32
      ||!Number.isInteger(readTimeoutMs)||readTimeoutMs<100||readTimeoutMs>60000)throw new Error('WORKER_ARTIFACT_PROVIDER_CONFIGURATION_INVALID');
    this.#manifest=Object.freeze({resolveVersion:manifest.resolveVersion.bind(manifest),probe:manifest.probe.bind(manifest)});
    this.#storage=Object.freeze({readVersion:storage.readVersion.bind(storage),probe:storage.probe.bind(storage)});
    this.#authorize=authorizeVersion;this.#verify=verifyEvidence;this.#payloadLimit=maxPayloadBytes;this.#policyLimit=maxPolicyBytes;this.#maxReads=maxConcurrentReads;this.#readTimeout=readTimeoutMs;
  }
  loadPayload({tenantId,payloadId,payloadHash,signal}={}){return this.#load({tenantId,id:payloadId,hash:payloadHash,kind:'PAYLOAD',signal});}
  loadPolicy({tenantId,policyVersionId,policyVersionHash,signal}={}){return this.#load({tenantId,id:policyVersionId,hash:policyVersionHash,kind:'POLICY',signal});}
  async #load(input){
    const signal=input.signal;
    if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'))throw fail();
    signalCheck(signal);if(this.#reads.size>=this.#maxReads)throw fail();
    const controller=new AbortController(),abort=()=>controller.abort();let timer,result;
    this.#reads.add(controller);
    try{signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      timer=setTimeout(abort,this.#readTimeout);
      // Abort requests cancellation but never releases ownership of an actual
      // provider callback/iterator until it and cleanup have really settled.
      result=await this.#read({...input,signal:controller.signal});return result;
    }catch{throw fail();}finally{clearTimeout(timer);try{signal?.removeEventListener('abort',abort);}catch{releaseManagedArtifact(result);throw fail();}finally{this.#reads.delete(controller);}}
  }
  async #read({tenantId,id,hash,kind,signal}){
    if(typeof tenantId!=='string'||!UUID.test(tenantId)||typeof id!=='string'||!UUID.test(id)||typeof hash!=='string'||!HEX.test(hash)
      ||signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'))throw fail();
    const request=Object.freeze({tenantId:tenantId.toLowerCase(),id:id.toLowerCase(),hash,kind,signal});
    const limit=kind==='PAYLOAD'?this.#payloadLimit:this.#policyLimit,chunks=[];let bytes,iterator;
    const gate=async(value,phase)=>{signalCheck(signal);if(await this.#authorize(Object.freeze({...value,phase,signal}))!==true)throw fail();signalCheck(signal);};
    try{
      await gate(request,'RESOLVE');
      const manifest=data(await this.#manifest.resolveVersion(request),fields);signalCheck(signal);
      if(manifest.tenantId!==request.tenantId||manifest.id!==request.id||manifest.kind!==kind||manifest.hash!==hash||!HEX.test(manifest.evidenceHash??'')
        ||typeof manifest.objectKey!=='string'||manifest.objectKey.length>512||!manifest.objectKey.startsWith(request.tenantId+'/')||!/^[-A-Za-z0-9_./]+$/.test(manifest.objectKey)
        ||manifest.objectKey.split('/').some(p=>!p||p==='.'||p==='..')||typeof manifest.versionId!=='string'||!/^[-A-Za-z0-9_+/=.:]{1,256}$/.test(manifest.versionId)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(manifest.versionId)||['latest','current','null','undefined','head'].includes(manifest.versionId.toLowerCase())
        ||!Number.isSafeInteger(manifest.size)||manifest.size<1||manifest.size>limit||manifest.state!==(kind==='PAYLOAD'?'PROCESSING_ALLOWED':'PUBLISHED')
        ||typeof manifest.region!=='string'||!/^[a-z0-9-]{1,64}$/.test(manifest.region)||!Number.isSafeInteger(manifest.revision)||manifest.revision<1)throw fail();
      Object.freeze(manifest);await gate(manifest,'READ_VERSION');
      if(await this.#verify(Object.freeze({...manifest,signal}))!==true)throw fail();signalCheck(signal);
      const rawResponse=await this.#storage.readVersion(Object.freeze({...manifest,maxBytes:limit,signal}));
      const body=rawResponse&&Object.getOwnPropertyDescriptor(rawResponse,'body')?.value;
      if(typeof body?.[Symbol.asyncIterator]==='function'){
        const raw=body[Symbol.asyncIterator]();
        if(typeof raw?.next==='function'&&typeof raw?.return==='function'){let closing;iterator={next:raw.next.bind(raw),return:()=>{closing??=Promise.resolve().then(()=>raw.return());return closing;}};}
      }
      const response=data(rawResponse,['tenantId','objectKey','versionId','hash','contentLength','body']);
      signalCheck(signal);
      if(response.tenantId!==manifest.tenantId||response.objectKey!==manifest.objectKey||response.versionId!==manifest.versionId||response.hash!==hash||response.contentLength!==manifest.size
        ||typeof iterator?.next!=='function'||typeof iterator?.return!=='function')throw fail();
      let length=0,count=0;
      // SDK adapters must stream; the boundary never follows URLs or resolves a
      // caller-supplied key. for-await also awaits iterator cleanup on rejection.
      for await(const chunk of {[Symbol.asyncIterator]:()=>iterator}){
        signalCheck(signal);
        if((!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))||chunk.byteLength===0||++count>4096||length+chunk.byteLength>manifest.size)throw fail();
        const copy=Buffer.from(chunk);chunks.push(copy);length+=copy.length;
      }
      signalCheck(signal);if(length!==manifest.size)throw fail();bytes=Buffer.concat(chunks,length);
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw fail();
      // Cleanup can block, cancel or revoke permissions. Complete it before
      // the final manifest/evidence/authorization checks and byte transfer.
      await iterator.return();iterator=undefined;signalCheck(signal);
      const current=data(await this.#manifest.resolveVersion(request),fields);signalCheck(signal);
      if(fields.some(k=>current[k]!==manifest[k]))throw fail();
      if(await this.#verify(Object.freeze({...current,signal}))!==true)throw fail();await gate(manifest,'RETURN_VERSION');
      const result=Object.freeze({tenantId:manifest.tenantId,id:manifest.id,hash,state:manifest.state,bytes});ownedArtifacts.set(result,bytes);bytes=undefined;return result;
    }catch{throw fail();}finally{
      try{if(typeof iterator?.return==='function')await iterator.return();}catch{throw fail();}
      finally{bytes?.fill(0);for(const chunk of chunks)chunk.fill(0);}
    }
  }
  async probe({signal}={}){
    const safe=ok=>Object.freeze({ok,code:ok?'WORKER_ARTIFACT_PROVIDER_VERIFIED':'WORKER_ARTIFACT_PROVIDER_UNVERIFIED'});
    const available=()=>this.#reads.size<this.#maxReads&&![...this.#reads].some(c=>c.signal.aborted);
    if(this.#probePending||!available())return safe(false);
    this.#probePending=true;
    try{signalCheck(signal);const a=await this.#manifest.probe({signal});signalCheck(signal);const b=await this.#storage.probe({signal});signalCheck(signal);
      return safe(a?.ok===true&&b?.ok===true&&available());
    }catch{return safe(false);}finally{this.#probePending=false;}
  }
}
