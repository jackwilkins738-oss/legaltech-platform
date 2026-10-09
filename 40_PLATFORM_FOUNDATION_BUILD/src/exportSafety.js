import crypto from 'node:crypto';
import {assertSynchronousInterlock} from './interlockBoundary.js';
import {canonicalAuditPayload} from './securityMonitoring.js';

const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const HEX64=/^[a-f0-9]{64}$/;
const MAX_RESOURCES=5000;
const MAX_PACKAGE_BYTES=250*1024*1024;
const MAX_GRANT_MS=15*60*1000;
const clone=value=>structuredClone(value);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonicalHash=value=>digest(canonicalAuditPayload(value));
function id(value,error){if(typeof value!=='string'||!SAFE_ID.test(value))throw new Error(error);return value;}
function code(value,error){if(typeof value!=='string'||!CODE.test(value))throw new Error(error);return value;}
function exactObject(value,allowed,error){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(error);for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(error);return value;}
function resources(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_RESOURCES)throw new Error('EXPORT_RESOURCE_SET_INVALID');
  const seen=new Set();
  return value.map(raw=>{exactObject(raw,['resourceClass','resourceRef','matterId'],'EXPORT_RESOURCE_INVALID');const item={resourceClass:code(raw.resourceClass,'EXPORT_RESOURCE_CLASS_INVALID'),resourceRef:id(raw.resourceRef,'EXPORT_RESOURCE_REF_INVALID'),matterId:raw.matterId==null?null:id(raw.matterId,'EXPORT_MATTER_ID_INVALID')};const key=`${item.resourceClass}:${item.resourceRef}`;if(seen.has(key))throw new Error('EXPORT_RESOURCE_DUPLICATE');seen.add(key);return Object.freeze(item);});
}
function constantEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}

export class ControlledExportRegistry {
  #now;#authorize;#validateStorage;#interlock;#requests=new Map();#inventories=new Map();#idempotency=new Map();#grants=new Map();#events=[];
  constructor({authorizeResource,validateStorageRef,securityInterlock=null,now=()=>Date.now()}={}){
    if(typeof authorizeResource!=='function'||typeof validateStorageRef!=='function'||typeof now!=='function')throw new Error('EXPORT_CONFIGURATION_INVALID');
    if(securityInterlock!==null&&typeof securityInterlock?.assertAllowed!=='function')throw new Error('EXPORT_CONFIGURATION_INVALID');this.#authorize=authorizeResource;this.#validateStorage=validateStorageRef;this.#interlock=securityInterlock;this.#now=now;
  }
  requestExport(input){
    exactObject(input,['tenantId','actorId','traceId','resourceSet','format','idempotencyKey'],'EXPORT_REQUEST_SHAPE_INVALID');
    const tenantId=id(input.tenantId,'EXPORT_TENANT_REQUIRED'),actorId=id(input.actorId,'EXPORT_ACTOR_REQUIRED'),traceId=id(input.traceId,'EXPORT_TRACE_REQUIRED'),format=code(input.format,'EXPORT_FORMAT_INVALID'),idempotencyKey=id(input.idempotencyKey,'EXPORT_IDEMPOTENCY_INVALID'),set=resources(input.resourceSet);
    assertSynchronousInterlock(this.#interlock,{tenantId,operation:'EXPORT'});
    for(const item of set){let allowed=false;try{allowed=this.#authorize({tenantId,actorId,traceId,resource:clone(item)})===true;}catch{throw new Error('EXPORT_AUTHORIZATION_UNAVAILABLE');}if(!allowed)throw new Error('EXPORT_RESOURCE_FORBIDDEN');}
    const manifest={format,resources:set.map(x=>({...x}))},manifestHash=canonicalHash(manifest),idem=`${tenantId}:${idempotencyKey}`,prior=this.#idempotency.get(idem);
    if(prior){if(prior.fingerprint!==manifestHash)throw new Error('EXPORT_IDEMPOTENCY_CONFLICT');const old=this.#requests.get(`${tenantId}:${prior.exportId}`);if(!old)throw new Error('EXPORT_IDEMPOTENCY_UNAVAILABLE');return Object.freeze({...clone(old),replayed:true});}
    const at=this.#at(),row={id:`exp_${crypto.randomUUID()}`,tenantId,requestedBy:actorId,format,resourceCount:set.length,matterCount:new Set(set.map(x=>x.matterId).filter(Boolean)).size,manifestHash,status:'REQUESTED',createdAt:at,readyAt:null,revokedAt:null,revokedBy:null,packageSha256:null,packageBytes:null,storageRef:null};
    this.#requests.set(`${tenantId}:${row.id}`,row);this.#inventories.set(`${tenantId}:${row.id}`,Object.freeze(set));this.#idempotency.set(idem,{fingerprint:manifestHash,exportId:row.id});this.#event(row,'EXPORT_REQUESTED',actorId,traceId,{format,resourceCount:row.resourceCount,matterCount:row.matterCount,manifestHash});return Object.freeze({...clone(row),replayed:false});
  }
  markReady(input){
    exactObject(input,['tenantId','exportId','actorId','traceId','manifestHash','packageSha256','packageBytes','storageRef'],'EXPORT_READY_SHAPE_INVALID');
    const tenantId=id(input.tenantId,'EXPORT_TENANT_REQUIRED'),exportId=id(input.exportId,'EXPORT_ID_INVALID'),actorId=id(input.actorId,'EXPORT_ACTOR_REQUIRED'),traceId=id(input.traceId,'EXPORT_TRACE_REQUIRED');
    if(!HEX64.test(String(input.manifestHash??''))||!HEX64.test(String(input.packageSha256??'')))throw new Error('EXPORT_DIGEST_INVALID');const bytes=Number(input.packageBytes);if(!Number.isSafeInteger(bytes)||bytes<1||bytes>MAX_PACKAGE_BYTES)throw new Error('EXPORT_PACKAGE_SIZE_INVALID');const storageRef=id(input.storageRef,'EXPORT_STORAGE_REF_INVALID');
    let valid=false;try{valid=this.#validateStorage({tenantId,exportId,storageRef,packageSha256:input.packageSha256,packageBytes:bytes})===true;}catch{throw new Error('EXPORT_STORAGE_VALIDATION_UNAVAILABLE');}if(!valid)throw new Error('EXPORT_STORAGE_EVIDENCE_INVALID');
    const row=this.#get(tenantId,exportId);if(row.status==='READY'){if(row.manifestHash!==input.manifestHash||row.packageSha256!==input.packageSha256||row.packageBytes!==bytes||row.storageRef!==storageRef)throw new Error('EXPORT_READY_CONFLICT');return Object.freeze({...clone(row),replayed:true});}if(row.status!=='REQUESTED')throw new Error('EXPORT_REQUEST_CLOSED');if(row.manifestHash!==input.manifestHash)throw new Error('EXPORT_MANIFEST_MISMATCH');
    row.status='READY';row.readyAt=this.#at();row.packageSha256=input.packageSha256;row.packageBytes=bytes;row.storageRef=storageRef;this.#event(row,'EXPORT_READY',actorId,traceId,{packageSha256:row.packageSha256,packageBytes:bytes,manifestHash:row.manifestHash});return Object.freeze({...clone(row),replayed:false});
  }
  issueDownloadGrant(input){
    exactObject(input,['tenantId','exportId','actorId','traceId','ttlMs'],'EXPORT_GRANT_SHAPE_INVALID');const tenantId=id(input.tenantId,'EXPORT_TENANT_REQUIRED'),exportId=id(input.exportId,'EXPORT_ID_INVALID'),actorId=id(input.actorId,'EXPORT_ACTOR_REQUIRED'),traceId=id(input.traceId,'EXPORT_TRACE_REQUIRED'),ttlMs=Number(input.ttlMs);
    if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_GRANT_MS)throw new Error('EXPORT_GRANT_TTL_INVALID');assertSynchronousInterlock(this.#interlock,{tenantId,operation:'EXPORT'});const row=this.#get(tenantId,exportId);if(row.status!=='READY')throw new Error('EXPORT_NOT_READY');if(row.requestedBy!==actorId)throw new Error('EXPORT_GRANT_ACTOR_FORBIDDEN');
    this.#authorizeCurrent(row,actorId,traceId);assertSynchronousInterlock(this.#interlock,{tenantId,operation:'EXPORT'});if(row.status!=='READY')throw new Error('EXPORT_NOT_READY');
    const secret=crypto.randomBytes(32).toString('base64url'),tokenHash=digest(secret),grant={id:`xgr_${crypto.randomUUID()}`,tenantId,exportId,actorId,tokenHash,status:'ACTIVE',issuedAt:this.#at(),expiresAt:new Date(this.#now()+ttlMs).toISOString(),consumedAt:null,revokedAt:null};this.#grants.set(`${tenantId}:${grant.id}`,grant);this.#event(row,'EXPORT_DOWNLOAD_GRANT_ISSUED',actorId,traceId,{grantId:grant.id,expiresAt:grant.expiresAt});return Object.freeze({grantId:grant.id,token:secret,expiresAt:grant.expiresAt});
  }
  consumeDownloadGrant(input){
    exactObject(input,['tenantId','grantId','actorId','traceId','token'],'EXPORT_CONSUME_SHAPE_INVALID');const tenantId=id(input.tenantId,'EXPORT_TENANT_REQUIRED'),grantId=id(input.grantId,'EXPORT_GRANT_ID_INVALID'),actorId=id(input.actorId,'EXPORT_ACTOR_REQUIRED'),traceId=id(input.traceId,'EXPORT_TRACE_REQUIRED');if(typeof input.token!=='string'||input.token.length<32||input.token.length>128)throw new Error('EXPORT_GRANT_INVALID');
    assertSynchronousInterlock(this.#interlock,{tenantId,operation:'EXPORT'});const grant=this.#grants.get(`${tenantId}:${grantId}`);if(!grant||grant.actorId!==actorId||grant.status!=='ACTIVE'||Date.parse(grant.expiresAt)<=this.#now()||!constantEqual(grant.tokenHash,digest(input.token)))throw new Error('EXPORT_GRANT_INVALID');const row=this.#get(tenantId,grant.exportId);if(row.status!=='READY')throw new Error('EXPORT_GRANT_INVALID');
    this.#authorizeCurrent(row,actorId,traceId);assertSynchronousInterlock(this.#interlock,{tenantId,operation:'EXPORT'});if(row.status!=='READY'||grant.status!=='ACTIVE'||Date.parse(grant.expiresAt)<=this.#now())throw new Error('EXPORT_GRANT_INVALID');
    grant.status='CONSUMED';grant.consumedAt=this.#at();this.#event(row,'EXPORT_DOWNLOADED',actorId,traceId,{grantId,packageSha256:row.packageSha256,packageBytes:row.packageBytes});return Object.freeze({exportId:row.id,storageRef:row.storageRef,packageSha256:row.packageSha256,packageBytes:row.packageBytes,manifestHash:row.manifestHash});
  }
  revokeExport(input){exactObject(input,['tenantId','exportId','actorId','traceId'],'EXPORT_REVOKE_SHAPE_INVALID');const tenantId=id(input.tenantId,'EXPORT_TENANT_REQUIRED'),exportId=id(input.exportId,'EXPORT_ID_INVALID'),actorId=id(input.actorId,'EXPORT_ACTOR_REQUIRED'),traceId=id(input.traceId,'EXPORT_TRACE_REQUIRED'),row=this.#get(tenantId,exportId);if(row.status==='REVOKED')return Object.freeze(clone(row));row.status='REVOKED';row.revokedAt=this.#at();row.revokedBy=actorId;for(const grant of this.#grants.values())if(grant.tenantId===tenantId&&grant.exportId===exportId&&grant.status==='ACTIVE'){grant.status='REVOKED';grant.revokedAt=row.revokedAt;}this.#event(row,'EXPORT_REVOKED',actorId,traceId,{});return Object.freeze(clone(row));}
  getExport(tenantId,exportId){const row=this.#requests.get(`${tenantId}:${exportId}`);return row?Object.freeze(clone(row)):null;}
  listEvents(tenantId){return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
  #get(tenantId,exportId){const row=this.#requests.get(`${tenantId}:${exportId}`);if(!row)throw new Error('EXPORT_UNAVAILABLE');return row;}
  #authorizeCurrent(row,actorId,traceId){const set=this.#inventories.get(`${row.tenantId}:${row.id}`);if(!set||canonicalHash({format:row.format,resources:set})!==row.manifestHash)throw new Error('EXPORT_MANIFEST_MISMATCH');for(const resource of set){let allowed=false;try{allowed=this.#authorize({tenantId:row.tenantId,actorId,traceId,resource:clone(resource)})===true;}catch{throw new Error('EXPORT_AUTHORIZATION_UNAVAILABLE');}if(!allowed)throw new Error('EXPORT_RESOURCE_FORBIDDEN');}}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`xee_${crypto.randomUUID()}`,tenantId:row.tenantId,exportId:row.id,eventType,actorId,traceId,at:this.#at(),evidence:clone(evidence)}));}
  #at(){return new Date(this.#now()).toISOString();}
}

export const EXPORT_LIMITS=Object.freeze({maxResources:MAX_RESOURCES,maxPackageBytes:MAX_PACKAGE_BYTES,maxGrantMs:MAX_GRANT_MS});
