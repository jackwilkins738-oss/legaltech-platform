import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const CHANNELS=new Set(['IN_APP','TEAMS']);
const OWNER_KINDS=new Set(['USER','ROLE','TEAM','POOL']);
const SAFE=/^[A-Za-z0-9._:/-]{1,256}$/;
const SECRET_KEY=/(?:secret|token|password|authorization|credential|cookie|api[_-]?key|private[_-]?key)/i;
const id=(v,c,max=256)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error(c);return v.trim();};
const safeCode=(v,c)=>{const out=id(v,c,256);if(!SAFE.test(out))throw new Error(c);return out;};
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const deepFreeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const value of Object.values(v))deepFreeze(value);}return v;};
function assertIntent(intent){if(!plain(intent)||!CHANNELS.has(intent.channel)||!SAFE.test(String(intent.templateId??''))||!plain(intent.recipient)||!OWNER_KINDS.has(intent.recipient.kind)||!SAFE.test(String(intent.recipient.id??''))||!SAFE.test(String(intent.objectType??''))||!SAFE.test(String(intent.objectId??''))||!SAFE.test(String(intent.id??''))||!SAFE.test(String(intent.tenantId??''))||!SAFE.test(String(intent.traceId??'')))throw new Error('NOTIFICATION_DELIVERY_INTENT_INVALID');return intent;}
function safeResult(value){if(!plain(value))throw new Error('NOTIFICATION_DELIVERY_RESULT_INVALID');const keys=Object.keys(value);if(keys.some(k=>k!=='deliveryRef'||SECRET_KEY.test(k)))throw new Error('NOTIFICATION_DELIVERY_RESULT_INVALID');const deliveryRef=safeCode(value.deliveryRef,'NOTIFICATION_DELIVERY_RESULT_INVALID');return {deliveryRefHash:sha(deliveryRef)};}
export class InAppDeliveryAdapter {async deliver(envelope){return {deliveryRef:`local:${safeCode(envelope.notificationId,'NOTIFICATION_DELIVERY_ID_INVALID')}`};}}

export class NotificationDeliveryWorker {
  #store;#intents;#adapters;#leaseMs;#timeoutMs;#now;#interlock;#executionBoundary;
  constructor({store,notificationIntents,adapters={},leaseMs=300000,timeoutMs=10000,securityInterlock=null,executionBoundary=null,now=()=>Date.now()}={}){
    if(!store||typeof store.recoverExpiredNotificationIntents!=='function'||typeof store.putNotificationDeliveryEvent!=='function'||!notificationIntents||typeof notificationIntents.claimNext!=='function'||typeof notificationIntents.claimById!=='function'||typeof notificationIntents.delivered!=='function'||typeof notificationIntents.failed!=='function')throw new Error('NOTIFICATION_DELIVERY_CONFIGURATION_INVALID');
    if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>30*60*1000||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60_000)throw new Error('NOTIFICATION_DELIVERY_BOUNDS_INVALID');
    if(securityInterlock!==null&&typeof securityInterlock?.assertAllowed!=='function')throw new Error('NOTIFICATION_DELIVERY_CONFIGURATION_INVALID');
    if(executionBoundary!==null&&(!executionBoundary||typeof executionBoundary.locate!=='function'||typeof executionBoundary.authorize!=='function'))throw new Error('NOTIFICATION_DELIVERY_CONFIGURATION_INVALID');
    const map={IN_APP:new InAppDeliveryAdapter(),...adapters};for(const [channel,adapter] of Object.entries(map)){if(!CHANNELS.has(channel)||!adapter||typeof adapter.deliver!=='function')throw new Error('NOTIFICATION_DELIVERY_ADAPTER_INVALID');}
    this.#store=store;this.#intents=notificationIntents;this.#adapters=Object.freeze({...map});this.#leaseMs=leaseMs;this.#timeoutMs=timeoutMs;this.#now=now;this.#interlock=securityInterlock;this.#executionBoundary=executionBoundary;
  }
  recoverExpired({tenantId,channel=null}){return this.#store.recoverExpiredNotificationIntents({tenantId,channel,leaseMs:this.#leaseMs,now:new Date(this.#now()).toISOString()});}
  expire({tenantId,channel=null}){return this.#store.expireNotificationIntents({tenantId,channel,now:new Date(this.#now()).toISOString()});}
  async processNext({tenantId,channel=null,executionToken=null}={}){
    tenantId=id(tenantId,'NOTIFICATION_DELIVERY_TENANT_REQUIRED');if(channel!==null&&!CHANNELS.has(channel))throw new Error('NOTIFICATION_DELIVERY_CHANNEL_INVALID');if(this.#interlock&&channel!=='IN_APP'){try{await this.#interlock.assertAllowed({tenantId,operation:'EXTERNAL_NOTIFICATION'});}catch(error){if(error?.message!=='SECURITY_INTERLOCK_ACTIVE')throw error;if(channel===null)channel='IN_APP';else return Object.freeze({status:'DEFERRED',channel,error:'SECURITY_INTERLOCK_ACTIVE'});}}this.expire({tenantId,channel});this.recoverExpired({tenantId,channel});let execution=null,intent;if(this.#executionBoundary){const locator=this.#executionBoundary.locate(executionToken),candidate=this.#store.getNotificationIntent(tenantId,locator.objectId);if(!candidate||channel!==null&&candidate.channel!==channel)return null;execution=this.#executionBoundary.authorize({token:executionToken,tenantId,workerType:'NOTIFICATION_DELIVERY',objectType:'NOTIFICATION',objectId:candidate.id,traceId:candidate.traceId});intent=this.#intents.claimById({tenantId,id:candidate.id,channel});}else intent=this.#intents.claimNext({tenantId,channel});if(!intent)return null;
    const at=()=>new Date(this.#now()).toISOString();
    try{
      assertIntent(intent);const adapter=this.#adapters[intent.channel];if(!adapter)throw new Error('NOTIFICATION_DELIVERY_ADAPTER_UNAVAILABLE');
      const envelope=deepFreeze({tenantId:intent.tenantId,notificationId:intent.id,channel:intent.channel,templateId:intent.templateId,recipient:{kind:intent.recipient.kind,id:intent.recipient.id},object:{type:intent.objectType,id:intent.objectId},severity:intent.severity,traceId:intent.traceId});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeoutMs);let result;
      try{result=await adapter.deliver(envelope,Object.freeze({signal:controller.signal}));}finally{clearTimeout(timer);}
      if(controller.signal.aborted)throw new Error('NOTIFICATION_DELIVERY_TIMEOUT');
      const receipt=safeResult(result);const delivered=this.#intents.delivered({tenantId:intent.tenantId,id:intent.id,traceId:intent.traceId});
      this.#event(delivered,'DELIVERED',receipt,at());
      return Object.freeze({notificationId:intent.id,status:'DELIVERED',channel:intent.channel,deliveryRefHash:receipt.deliveryRefHash});
    }catch{
      const current=this.#store.getNotificationIntent(intent.tenantId,intent.id);const retry=Boolean(current&&current.status==='SENDING'&&current.attempts<3);let failed=current;
      if(current?.status==='SENDING')failed=this.#intents.failed({tenantId:intent.tenantId,id:intent.id,traceId:intent.traceId,errorCode:'NOTIFICATION_DELIVERY_FAILED',retry});
      this.#event(intent,'FAILED',{errorCode:'NOTIFICATION_DELIVERY_FAILED',retry},at());
      this.#store.audit({tenantId:intent.tenantId,traceId:intent.traceId,actorId:execution?`service:${execution.serviceId}`:'system:notification-delivery',action:'NOTIFICATION_DELIVERY_FAILED',objectId:intent.id,outcome:'FAILED',reason:intent.channel});
      return Object.freeze({notificationId:intent.id,status:failed?.status??'DEAD',channel:intent.channel,error:'NOTIFICATION_DELIVERY_FAILED'});
    }
  }
  #event(intent,eventType,data,at){this.#store.putNotificationDeliveryEvent({id:this.#store.uid('nde'),tenantId:intent.tenantId,notificationId:intent.id,eventType,channel:intent.channel,traceId:intent.traceId,at,data:structuredClone(data)});}
}
