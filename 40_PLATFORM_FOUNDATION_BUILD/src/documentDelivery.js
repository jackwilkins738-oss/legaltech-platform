import crypto from 'node:crypto';
import {normalizeSession,documentAccessAllowed} from './auth.js';
import {canonicalAuditPayload} from './securityMonitoring.js';

const SAFE=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const HEX64=/^[a-f0-9]{64}$/;
const MAX_TTL_MS=5*60*1000;
const clone=v=>structuredClone(v);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const canonicalHash=v=>sha(canonicalAuditPayload(v));
function id(v,code,max=256){if(typeof v!=='string'||v.length<1||v.length>max||!SAFE.test(v))throw new Error(code);return v;}
function exact(v,keys,code){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(code);for(const k of Object.keys(v))if(!keys.includes(k))throw new Error(code);return v;}
function equalHex(a,b){return typeof a==='string'&&typeof b==='string'&&HEX64.test(a)&&HEX64.test(b)&&crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function safeType(v){if(typeof v!=='string'||v.length<1||v.length>255||/[\u0000-\u001f\u007f]/.test(v))throw new Error('DOCUMENT_DELIVERY_EVIDENCE_INVALID');return v;}
function resolved(value,tenantId,documentRef){
  exact(value,['document','matter','objectRef','sha256','size','contentType'],'DOCUMENT_DELIVERY_EVIDENCE_INVALID');
  const {document,matter}=value;if(!document||typeof document!=='object'||!matter||typeof matter!=='object')throw new Error('DOCUMENT_DELIVERY_EVIDENCE_INVALID');
  if(document.tenantId!==tenantId||document.documentRef!==documentRef||matter.tenantId!==tenantId||document.matterId!==matter.id)throw new Error('DOCUMENT_DELIVERY_EVIDENCE_INVALID');
  const objectRef=id(value.objectRef,'DOCUMENT_DELIVERY_EVIDENCE_INVALID',512),hash=String(value.sha256??''),size=Number(value.size),contentType=safeType(value.contentType);
  if(!HEX64.test(hash)||!Number.isSafeInteger(size)||size<0||size>15*1024*1024||!objectRef.endsWith('/'+hash))throw new Error('DOCUMENT_DELIVERY_EVIDENCE_INVALID');
  return {document,matter,objectRef,sha256:hash,size,contentType,bindingHash:canonicalHash({tenantId,matterId:matter.id,documentRef,objectRefHash:sha(objectRef),sha256:hash,size,contentType})};
}

export class DocumentDeliveryService {
  #resolve;#storage;#interlock;#support;#now;#grants=new Map();#events=[];
  constructor({resolveDocument,objectStorage,securityInterlock=null,supportAccess=null,now=()=>Date.now()}={}){
    if(typeof resolveDocument!=='function'||typeof objectStorage?.get!=='function'||typeof now!=='function')throw new Error('DOCUMENT_DELIVERY_CONFIGURATION_INVALID');
    if(securityInterlock!==null&&typeof securityInterlock?.assertAllowed!=='function')throw new Error('DOCUMENT_DELIVERY_CONFIGURATION_INVALID');
    if(supportAccess!==null&&typeof supportAccess?.assertDocumentRead!=='function')throw new Error('DOCUMENT_DELIVERY_CONFIGURATION_INVALID');
    this.#resolve=resolveDocument;this.#storage=objectStorage;this.#interlock=securityInterlock;this.#support=supportAccess;this.#now=now;
  }
  async issueGrant(input){
    exact(input,['session','documentRef','traceId','ttlMs'],'DOCUMENT_DELIVERY_REQUEST_INVALID');const session=normalizeSession(input.session),documentRef=id(input.documentRef,'DOCUMENT_DELIVERY_DOCUMENT_REQUIRED',512),traceId=id(input.traceId,'DOCUMENT_DELIVERY_TRACE_REQUIRED'),ttlMs=Number(input.ttlMs);
    if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_TTL_MS)throw new Error('DOCUMENT_DELIVERY_TTL_INVALID');this.#interlock?.assertAllowed({tenantId:session.tenantId,operation:'DOCUMENT_DELIVERY'});
    const evidence=await this.#resolveSafe(session.tenantId,documentRef);this.#interlock?.assertAllowed({tenantId:session.tenantId,operation:'DOCUMENT_DELIVERY'});if(!this.#authorized(session,evidence,documentRef,traceId))throw new Error('DOCUMENT_DELIVERY_UNAVAILABLE');
    const token=crypto.randomBytes(32).toString('base64url'),row={id:`dgr_${crypto.randomUUID()}`,tenantId:session.tenantId,actorId:session.actorId,matterId:evidence.matter.id,documentRefHash:sha(documentRef),bindingHash:evidence.bindingHash,tokenHash:sha(token),status:'ACTIVE',issuedAt:this.#at(),expiresAt:new Date(this.#now()+ttlMs).toISOString(),consumedAt:null};this.#grants.set(`${row.tenantId}:${row.id}`,row);this.#event(row,'DOCUMENT_DELIVERY_GRANT_ISSUED',traceId,{expiresAt:row.expiresAt,documentRefHash:row.documentRefHash,bindingHash:row.bindingHash});return Object.freeze({grantId:row.id,token,expiresAt:row.expiresAt});
  }
  async consumeGrant(input){
    exact(input,['session','grantId','traceId','token','documentRef'],'DOCUMENT_DELIVERY_CONSUME_INVALID');const session=normalizeSession(input.session),grantId=id(input.grantId,'DOCUMENT_DELIVERY_GRANT_INVALID'),traceId=id(input.traceId,'DOCUMENT_DELIVERY_TRACE_REQUIRED'),documentRef=id(input.documentRef,'DOCUMENT_DELIVERY_DOCUMENT_REQUIRED',512);
    if(typeof input.token!=='string'||input.token.length<32||input.token.length>128)throw new Error('DOCUMENT_DELIVERY_GRANT_INVALID');this.#interlock?.assertAllowed({tenantId:session.tenantId,operation:'DOCUMENT_DELIVERY'});
    const row=this.#grants.get(`${session.tenantId}:${grantId}`);if(!row||row.status!=='ACTIVE'||row.actorId!==session.actorId||Date.parse(row.expiresAt)<=this.#now()||row.documentRefHash!==sha(documentRef)||!equalHex(row.tokenHash,sha(input.token)))throw new Error('DOCUMENT_DELIVERY_GRANT_INVALID');
    const evidence=await this.#resolveSafe(session.tenantId,documentRef);if(evidence.matter.id!==row.matterId||!equalHex(evidence.bindingHash,row.bindingHash)||!this.#authorized(session,evidence,documentRef,traceId))throw new Error('DOCUMENT_DELIVERY_GRANT_INVALID');
    // Recheck after every await and immediately before the synchronous one-use claim.
    this.#interlock?.assertAllowed({tenantId:session.tenantId,operation:'DOCUMENT_DELIVERY'});
    if(row.status!=='ACTIVE'||Date.parse(row.expiresAt)<=this.#now())throw new Error('DOCUMENT_DELIVERY_GRANT_INVALID');
    row.status='CONSUMED';row.consumedAt=this.#at();let bytes;try{bytes=this.#storage.get({tenantId:session.tenantId,objectRef:evidence.objectRef});}catch{this.#event(row,'DOCUMENT_DELIVERY_FAILED',traceId,{reasonCode:'STORAGE_UNAVAILABLE'});throw new Error('DOCUMENT_DELIVERY_UNAVAILABLE');}
    if(!Buffer.isBuffer(bytes)||bytes.length!==evidence.size||sha(bytes)!==evidence.sha256){this.#event(row,'DOCUMENT_DELIVERY_FAILED',traceId,{reasonCode:'INTEGRITY_FAILURE'});throw new Error('DOCUMENT_DELIVERY_UNAVAILABLE');}
    this.#event(row,'DOCUMENT_DELIVERED',traceId,{documentRefHash:row.documentRefHash,bindingHash:row.bindingHash,sha256:evidence.sha256,size:evidence.size});return Object.freeze({documentRef,matterId:row.matterId,contentType:evidence.contentType,size:evidence.size,sha256:evidence.sha256,body:Buffer.from(bytes)});
  }
  listEvents(tenantId){tenantId=id(tenantId,'DOCUMENT_DELIVERY_TENANT_REQUIRED');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
  #authorized(session,evidence,documentRef,traceId){if(documentAccessAllowed(session,evidence.document,evidence.matter,{now:this.#now()}))return true;if(!this.#support)return false;try{this.#support.assertDocumentRead(session,{matterId:evidence.matter.id,documentRef,traceId});return true;}catch{return false;}}
  async #resolveSafe(tenantId,documentRef){let value;try{value=await this.#resolve({tenantId,documentRef});}catch{throw new Error('DOCUMENT_DELIVERY_UNAVAILABLE');}if(!value)throw new Error('DOCUMENT_DELIVERY_UNAVAILABLE');return resolved(value,tenantId,documentRef);}
  #event(row,eventType,traceId,evidence){this.#events.push(Object.freeze({id:`dde_${crypto.randomUUID()}`,tenantId:row.tenantId,grantId:row.id,actorId:row.actorId,matterId:row.matterId,eventType,traceId,at:this.#at(),evidence:Object.freeze(clone(evidence))}));}
  #at(){return new Date(this.#now()).toISOString();}
}

export const DOCUMENT_DELIVERY_LIMITS=Object.freeze({maxGrantMs:MAX_TTL_MS});
