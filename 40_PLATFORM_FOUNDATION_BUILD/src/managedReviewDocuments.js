import crypto from 'node:crypto';
import {isUtf8} from 'node:buffer';
import {isPostgresReviewReader} from './postgresReviewReader.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';
const registered=new WeakSet(),fail=code=>new Error('REVIEW_DOCUMENT_'+code);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const fields=['tenantId','eventId','resultJobId','resultHash','artifactHash','objectKey','versionId','size','contentType','evidenceHash','region','revision','state','malwareScan','parserIsolation'];
const inputFields=['tenantId','actorId','eventId','expectedResultJobId','expectedResultHash'];
function data(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)throw fail('INPUT_INVALID');const d=Object.getOwnPropertyDescriptors(v);if(keys.some(k=>!Object.hasOwn(d[k]??{},'value')))throw fail('INPUT_INVALID');return Object.freeze(Object.fromEntries(keys.map(k=>[k,d[k].value])));}
export function reviewDocumentInput(v){const r=data(v,inputFields);if(inputFields.filter(k=>k!=='expectedResultHash').some(k=>typeof r[k]!=='string'||!UUID.test(r[k]))||typeof r.expectedResultHash!=='string'||!HEX.test(r.expectedResultHash))throw fail('INPUT_INVALID');return r;}
export const isManagedReviewDocuments=v=>registered.has(v);
function signalValid(s){if(s!==undefined&&(typeof s?.aborted!=='boolean'||typeof s.addEventListener!=='function'||typeof s.removeEventListener!=='function'))throw fail('INPUT_INVALID');}
function manifest(v,r,item,max){const m=data(v,fields);if(m.tenantId!==r.tenantId||m.eventId!==r.eventId||m.resultJobId!==r.expectedResultJobId||m.resultHash!==r.expectedResultHash||m.artifactHash!==item.artifactHash
  ||typeof m.objectKey!=='string'||m.objectKey.length>512||!m.objectKey.startsWith(r.tenantId+'/')||!/^[-A-Za-z0-9_./]+$/.test(m.objectKey)||m.objectKey.split('/').some(p=>!p||p==='.'||p==='..')
  ||typeof m.versionId!=='string'||!/^[-A-Za-z0-9_+/=.:]{1,256}$/.test(m.versionId)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(m.versionId)||['latest','current','null','undefined','head'].includes(m.versionId.toLowerCase())
  ||!Number.isSafeInteger(m.size)||m.size<1||m.size>max||!['application/pdf','text/plain','application/json'].includes(m.contentType)||typeof m.evidenceHash!=='string'||!HEX.test(m.evidenceHash)
  ||typeof m.region!=='string'||!/^[a-z0-9-]{1,64}$/.test(m.region)||!Number.isSafeInteger(m.revision)||m.revision<1||m.state!=='REVIEW_ALLOWED'||m.malwareScan!=='CLEAN'||m.parserIsolation!=='ISOLATED')throw fail('UNAVAILABLE');return m;}
function sameResult(item,r){if(item.eventId!==r.eventId||item.resultJobId!==r.expectedResultJobId||item.resultHash!==r.expectedResultHash)throw fail('FORBIDDEN');}
// Own the source, callback, stream cleanup, buffer and shared lease until actual
// transfer completion. A deadline requests cancellation and proves no release.
export class ManagedReviewDocuments {
  #reader;#drain;#ready;#manifest;#storage;#authorize;#verify;#audit;#provider;#timeout;#capacity;#max;#pending=new Set();#probe=null;#closed=false;#uncertain=false;
  constructor({reader,drain,readiness,manifest:manifestProvider,storage,authorizeDocument,verifyEvidence,audit,probeDocuments,timeoutMs=10000,maxPending=4,maxBytes=15*1024*1024}={}){
    if(!isPostgresReviewReader(reader)||!isManagedDeploymentDrain(drain)||!isProductionReadiness(readiness)||['resolveVersion','probe'].some(k=>typeof manifestProvider?.[k]!=='function')||['readVersion','probe'].some(k=>typeof storage?.[k]!=='function')||[authorizeDocument,verifyEvidence,audit,probeDocuments].some(f=>typeof f!=='function')||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(maxPending)||maxPending<1||maxPending>16||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>15*1024*1024)throw fail('CONFIGURATION_INVALID');
    this.#reader=Object.freeze({get:reader.get.bind(reader),probe:reader.probe.bind(reader)});this.#drain=drain;this.#ready=readiness;this.#manifest=Object.freeze({resolveVersion:manifestProvider.resolveVersion.bind(manifestProvider),probe:manifestProvider.probe.bind(manifestProvider)});this.#storage=Object.freeze({readVersion:storage.readVersion.bind(storage),probe:storage.probe.bind(storage)});this.#authorize=authorizeDocument;this.#verify=verifyEvidence;this.#audit=audit;this.#provider=probeDocuments;this.#timeout=timeoutMs;this.#capacity=maxPending;this.#max=maxBytes;registered.add(this);Object.freeze(this);
  }
  status(){return Object.freeze({inFlight:this.#pending.size,uncertain:this.#uncertain,acceptingNew:!this.#closed&&!this.#uncertain&&this.#pending.size<this.#capacity});}
  #check(signal){if(signal?.aborted||this.#closed||this.#uncertain)throw fail('UNAVAILABLE');}
  async #gate(r,m,phase,signal){this.#check(signal);let ok;try{ok=await this.#authorize(Object.freeze({...r,...m,phase,operation:'REVIEW_DOCUMENT',signal}));}catch{throw fail('UNAVAILABLE');}this.#check(signal);if(ok!==true)throw fail('FORBIDDEN');}
  deliver(value,{signal,consume}={}){
    const r=reviewDocumentInput(value);signalValid(signal);if(typeof consume!=='function')throw fail('INPUT_INVALID');this.#check(signal);if(!this.status().acceptingNew)throw fail('UNAVAILABLE');
    const controller=new AbortController(),entry={controller,admitted:false};this.#pending.add(entry);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,this.#timeout);
    const task=Promise.resolve().then(async()=>{let lease,bytes,iterator,error;const chunks=[],internal=controller.signal,traceId=`review-document:${crypto.randomUUID()}`;
      const binding=Object.freeze({...r,traceId,operation:'REVIEW_DOCUMENT',signal:internal});
      try{this.#check(internal);if(await boundedReadinessStatus(this.#ready,1500)!=='READY')throw fail('UNAVAILABLE');this.#check(internal);entry.admitted=true;
        try{lease=await this.#drain.acquire({kind:'INGRESS',operationId:traceId});}catch{this.#uncertain=true;throw fail('UNAVAILABLE');}this.#check(internal);
        await this.#audit(Object.freeze({...binding,phase:'ATTEMPT'}));this.#check(internal);
        const scope={tenantId:r.tenantId,actorId:r.actorId,eventId:r.eventId},item=await this.#reader.get(scope,{signal:internal});this.#check(internal);sameResult(item,r);await this.#gate(r,{artifactHash:item.artifactHash},'RESOLVE',internal);
        const lookup=Object.freeze({...r,artifactHash:item.artifactHash,signal:internal}),m=manifest(await this.#manifest.resolveVersion(lookup),r,item,this.#max);this.#check(internal);
        if(await this.#verify(Object.freeze({...m,actorId:r.actorId,signal:internal}))!==true)throw fail('UNAVAILABLE');await this.#gate(r,m,'READ_VERSION',internal);
        const raw=await this.#storage.readVersion(Object.freeze({...m,actorId:r.actorId,maxBytes:this.#max,signal:internal}));
        const body=raw&&Object.getOwnPropertyDescriptor(raw,'body')?.value;if(typeof body?.[Symbol.asyncIterator]==='function'){const source=body[Symbol.asyncIterator]();if(typeof source?.next==='function'&&typeof source?.return==='function'){let closing;iterator={next:source.next.bind(source),return:()=>{closing??=Promise.resolve().then(()=>source.return()).then(result=>{if(Object.getOwnPropertyDescriptor(result??{},'done')?.value!==true)throw fail('UNAVAILABLE');return result;}).catch(error=>{this.#uncertain=true;controller.abort();throw error;});return closing;}};}else{this.#uncertain=true;controller.abort();throw fail('UNAVAILABLE');}}
        const response=data(raw,['tenantId','objectKey','versionId','hash','contentLength','body']);this.#check(internal);
        if(response.tenantId!==m.tenantId||response.objectKey!==m.objectKey||response.versionId!==m.versionId||response.hash!==m.artifactHash||response.contentLength!==m.size||!iterator)throw fail('UNAVAILABLE');
        let length=0,count=0;for await(const chunk of {[Symbol.asyncIterator]:()=>iterator}){this.#check(internal);if((!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))||!chunk.byteLength||++count>4096||length+chunk.byteLength>m.size)throw fail('UNAVAILABLE');const copy=Buffer.from(chunk);chunks.push(copy);length+=copy.length;}
        this.#check(internal);if(length!==m.size)throw fail('UNAVAILABLE');bytes=Buffer.concat(chunks,length);if(crypto.createHash('sha256').update(bytes).digest('hex')!==m.artifactHash)throw fail('UNAVAILABLE');
        if(m.contentType==='application/pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||m.contentType!=='application/pdf'&&!isUtf8(bytes))throw fail('UNAVAILABLE');
        await iterator.return();iterator=undefined;this.#check(internal);
        await this.#audit(Object.freeze({...binding,phase:'PREPARED',artifactHash:m.artifactHash,size:m.size,contentType:m.contentType}));this.#check(internal);
        const current=manifest(await this.#manifest.resolveVersion(lookup),r,item,this.#max);this.#check(internal);if(fields.some(k=>current[k]!==m[k]))throw fail('UNAVAILABLE');
        if(await this.#verify(Object.freeze({...current,actorId:r.actorId,signal:internal}))!==true)throw fail('UNAVAILABLE');this.#check(internal);
        // Audit first, then re-observe the adopted result/current human identity
        // and both object/document authorities immediately before transfer.
        const final=await this.#reader.get(scope,{signal:internal,beforeRelease:async()=>{try{await this.#gate(r,current,'RELEASE',internal);}catch(e){if(e.message==='REVIEW_DOCUMENT_FORBIDDEN')throw Error('REVIEW_READ_FORBIDDEN');throw e;}}});this.#check(internal);sameResult(final,r);if(final.artifactHash!==m.artifactHash)throw fail('FORBIDDEN');
        await consume(Object.freeze({eventId:r.eventId,resultJobId:r.expectedResultJobId,resultHash:r.expectedResultHash,artifactHash:m.artifactHash,contentType:m.contentType,size:m.size,bytes,signal:internal}));this.#check(internal);
      }catch(e){error=e;}finally{
        try{if(iterator)await iterator.return();}catch{error=fail('UNAVAILABLE');}finally{bytes?.fill(0);for(const b of chunks)b.fill(0);if(lease)try{await this.#drain.release(lease);}catch{this.#uncertain=true;error=fail('UNAVAILABLE');}}
      }
      if(error){if(['REVIEW_DOCUMENT_FORBIDDEN','REVIEW_READ_FORBIDDEN'].includes(error.message))throw fail('FORBIDDEN');throw fail('UNAVAILABLE');}this.#check(internal);return Object.freeze({prepared:true});
    });entry.task=task;task.finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#pending.delete(entry);}).catch(()=>{});return task;
  }
  async probe({signal}={}){signalValid(signal);const unhealthy=()=>signal?.aborted||this.#closed||this.#uncertain||[...this.#pending].filter(p=>p.admitted).length>=this.#capacity||[...this.#pending].some(p=>p.controller.signal.aborted);if(this.#probe||unhealthy())return Object.freeze({ok:false,code:'REVIEW_DOCUMENT_UNVERIFIED'});
    const task=Promise.resolve().then(async()=>{const out=await Promise.allSettled([()=>this.#reader.probe({signal}),()=>this.#manifest.probe({signal}),()=>this.#storage.probe({signal}),()=>this.#provider({signal})].map(f=>Promise.resolve().then(f)));return Object.freeze({ok:!unhealthy()&&out.every(r=>r.status==='fulfilled'&&r.value?.ok===true),code:!unhealthy()&&out.every(r=>r.status==='fulfilled'&&r.value?.ok===true)?'REVIEW_DOCUMENT_VERIFIED':'REVIEW_DOCUMENT_UNVERIFIED'});});this.#probe=task;try{return await task;}finally{if(this.#probe===task)this.#probe=null;}}
  resume(){if(this.#pending.size||this.#probe||this.#uncertain)throw fail('UNAVAILABLE');this.#closed=false;}
  async stop({timeoutMs=5000}={}){if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw fail('INPUT_INVALID');this.#closed=true;for(const p of this.#pending)p.controller.abort();let timer;const settled=await Promise.race([Promise.allSettled([...this.#pending].map(p=>p.task).concat(this.#probe?[this.#probe]:[])).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),timeoutMs);})]);clearTimeout(timer);return Object.freeze({drained:settled&&!this.#pending.size&&!this.#probe&&!this.#uncertain,inFlight:this.#pending.size});}
}
