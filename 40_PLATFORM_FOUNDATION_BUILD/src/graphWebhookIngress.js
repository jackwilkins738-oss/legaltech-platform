import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const GRAPH_CALLER='0bf30f3b-4a52-48df-9a82-234910c4a086';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:@\/-]{0,2047}$/;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANGE=new Set(['created','updated','deleted','unknownFutureValue']);
const LIFECYCLE=new Set(['missed','subscriptionRemoved','reauthorizationRequired']);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const safeEqual=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function obj(v,code){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(code);return v;}
function id(v,code,max=2048){if(typeof v!=='string'||v.length<1||v.length>max||!/^[^\u0000-\u001f\u007f]+$/.test(v))throw new Error(code);return v;}
function guid(v,code){if(typeof v!=='string'||!GUID.test(v))throw new Error(code);return v.toLowerCase();}
function iso(v,code){const n=Date.parse(v);if(!Number.isFinite(n))throw new Error(code);return new Date(n).toISOString();}
function subscription(raw,now){obj(raw,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID');const tenantId=id(raw.tenantId,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID',200),subscriptionId=guid(raw.subscriptionId,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID'),directoryTenantId=guid(raw.directoryTenantId,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID'),clientState=id(raw.clientState,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID',255),status=raw.status,expiresAt=iso(raw.expiresAt,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID');if(status!=='ACTIVE'||Date.parse(expiresAt)<=now)throw new Error('GRAPH_WEBHOOK_SUBSCRIPTION_UNAVAILABLE');const richData=raw.richData===true,appId=richData?guid(raw.appId,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID'):raw.appId==null?null:guid(raw.appId,'GRAPH_WEBHOOK_SUBSCRIPTION_INVALID');return Object.freeze({tenantId,subscriptionId,directoryTenantId,clientState,status,expiresAt,richData,appId});}
function fingerprint(sub,row){return sha(canonicalAuditPayload({tenantId:sub.tenantId,subscriptionId:sub.subscriptionId,notificationId:row.id??null,resource:row.resource,changeType:row.changeType??null,lifecycleEvent:row.lifecycleEvent??null,subscriptionExpirationDateTime:row.subscriptionExpirationDateTime}));}

export function graphValidationResponse(validationToken){
  if(typeof validationToken!=='string'||Buffer.byteLength(validationToken,'utf8')<1||Buffer.byteLength(validationToken,'utf8')>4096||validationToken.includes('\u0000'))throw new Error('GRAPH_VALIDATION_TOKEN_INVALID');
  return Object.freeze({status:200,contentType:'text/plain; charset=utf-8',body:validationToken});
}

/** Reference boundary. Production must persist the staged payload in an isolated queue. */
export class GraphWebhookIngress {
  #resolve;#verifyTokens;#now;#maxItems;#maxBytes;#staged=new Map();#seen=new Set();#events=[];
  constructor({resolveSubscription,verifyValidationTokens=null,now=()=>Date.now(),maxItems=100,maxBytes=256*1024}={}){
    if(typeof resolveSubscription!=='function'||(verifyValidationTokens!==null&&typeof verifyValidationTokens!=='function')||typeof now!=='function'||!Number.isInteger(maxItems)||maxItems<1||maxItems>1000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024)throw new Error('GRAPH_WEBHOOK_CONFIGURATION_INVALID');
    this.#resolve=resolveSubscription;this.#verifyTokens=verifyValidationTokens;this.#now=now;this.#maxItems=maxItems;this.#maxBytes=maxBytes;
  }
  receive(payload,{traceId}={}){
    traceId=id(traceId,'GRAPH_WEBHOOK_TRACE_INVALID',256);obj(payload,'GRAPH_WEBHOOK_PAYLOAD_INVALID');const bytes=Buffer.byteLength(JSON.stringify(payload));if(bytes>this.#maxBytes)throw new Error('GRAPH_WEBHOOK_PAYLOAD_TOO_LARGE');if(!Array.isArray(payload.value)||payload.value.length<1||payload.value.length>this.#maxItems)throw new Error('GRAPH_WEBHOOK_BATCH_INVALID');
    const intakeId=`gwi_${crypto.randomUUID()}`;this.#staged.set(intakeId,{payload:structuredClone(payload),payloadHash:sha(JSON.stringify(payload)),traceId,receivedAt:new Date(this.#now()).toISOString()});this.#events.push(Object.freeze({intakeId,action:'GRAPH_WEBHOOK_RECEIVED',traceId,payloadHash:this.#staged.get(intakeId).payloadHash,at:this.#staged.get(intakeId).receivedAt}));return Object.freeze({status:202,intakeId});
  }
  async validate(intakeId){
    intakeId=id(intakeId,'GRAPH_WEBHOOK_INTAKE_INVALID',256);const staged=this.#staged.get(intakeId);if(!staged)throw new Error('GRAPH_WEBHOOK_INTAKE_UNAVAILABLE');this.#staged.delete(intakeId);
    const payload=staged.payload,verifiedClaims=await this.#verifiedClaims(payload.validationTokens);
    const accepted=[];for(const raw of payload.value){
      const row=obj(raw,'GRAPH_WEBHOOK_NOTIFICATION_INVALID'),subscriptionId=guid(row.subscriptionId,'GRAPH_WEBHOOK_NOTIFICATION_INVALID');let resolved;try{resolved=await this.#resolve({subscriptionId});}catch(error){if(['GRAPH_SUBSCRIPTION_SECRET_UNAVAILABLE','GRAPH_SUBSCRIPTION_CLOCK_INVALID'].includes(error?.message))throw new Error('GRAPH_WEBHOOK_DEPENDENCY_UNAVAILABLE');throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');}const sub=subscription(resolved,this.#now());if(sub.subscriptionId!==subscriptionId)throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');
      const payloadTenant=guid(row.tenantId,'GRAPH_WEBHOOK_NOTIFICATION_INVALID');if(payloadTenant!==sub.directoryTenantId||!safeEqual(row.clientState,sub.clientState))throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');
      const resource=id(row.resource,'GRAPH_WEBHOOK_NOTIFICATION_INVALID'),expiration=iso(row.subscriptionExpirationDateTime,'GRAPH_WEBHOOK_NOTIFICATION_INVALID');if(Date.parse(expiration)<=this.#now()-24*60*60*1000)throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');
      const change=row.changeType??null,lifecycle=row.lifecycleEvent??null;if((change===null)===(lifecycle===null))throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');if(change!==null&&!CHANGE.has(change))throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');if(lifecycle!==null&&!LIFECYCLE.has(lifecycle))throw new Error('GRAPH_WEBHOOK_NOTIFICATION_INVALID');
      if(row.id!=null)id(row.id,'GRAPH_WEBHOOK_NOTIFICATION_INVALID',512);if(sub.richData&&!verifiedClaims.some(c=>c.directoryTenantId===sub.directoryTenantId&&c.appId===sub.appId&&c.callerAppId===GRAPH_CALLER))throw new Error('GRAPH_WEBHOOK_TOKEN_INVALID');
      const fp=fingerprint(sub,row),duplicate=this.#seen.has(fp);if(!duplicate)this.#seen.add(fp);
      accepted.push(Object.freeze({tenantId:sub.tenantId,subscriptionId:sub.subscriptionId,notificationFingerprint:fp,resource,changeType:change,lifecycleEvent:lifecycle,duplicate}));
    }
    this.#events.push(Object.freeze({intakeId,action:'GRAPH_WEBHOOK_VALIDATED',traceId:staged.traceId,payloadHash:staged.payloadHash,itemCount:accepted.length,duplicateCount:accepted.filter(x=>x.duplicate).length,at:new Date(this.#now()).toISOString()}));return Object.freeze(accepted);
  }
  async #verifiedClaims(tokens){
    if(tokens==null)return Object.freeze([]);if(!Array.isArray(tokens)||tokens.length<1||tokens.length>32||tokens.some(t=>typeof t!=='string'||t.length<20||t.length>16_384))throw new Error('GRAPH_WEBHOOK_TOKEN_INVALID');if(!this.#verifyTokens)throw new Error('GRAPH_WEBHOOK_TOKEN_VERIFIER_REQUIRED');
    let claims;try{claims=await this.#verifyTokens(Object.freeze([...tokens]));}catch(error){if(error?.message==='GRAPH_WEBHOOK_VERIFIER_UNAVAILABLE')throw new Error('GRAPH_WEBHOOK_DEPENDENCY_UNAVAILABLE');throw new Error('GRAPH_WEBHOOK_TOKEN_INVALID');}if(!Array.isArray(claims)||claims.length!==tokens.length)throw new Error('GRAPH_WEBHOOK_TOKEN_INVALID');
    return Object.freeze(claims.map(c=>{obj(c,'GRAPH_WEBHOOK_TOKEN_INVALID');return Object.freeze({directoryTenantId:guid(c.directoryTenantId,'GRAPH_WEBHOOK_TOKEN_INVALID'),appId:guid(c.appId,'GRAPH_WEBHOOK_TOKEN_INVALID'),callerAppId:guid(c.callerAppId,'GRAPH_WEBHOOK_TOKEN_INVALID')});}));
  }
  events(){return Object.freeze(this.#events.map(e=>Object.freeze({...e})));}
}

export const GRAPH_CHANGE_NOTIFICATION_CALLER_APP_ID=GRAPH_CALLER;
