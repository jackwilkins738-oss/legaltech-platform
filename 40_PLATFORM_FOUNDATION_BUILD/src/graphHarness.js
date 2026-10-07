import crypto from 'node:crypto';
import {appError} from './errors.js';

const clone = x => structuredClone(x);
const invalid = () => appError('invalid integration request', {code:'INVALID_REQUEST'});
const unavailable = () => appError('resource unavailable', {status:404,code:'NOT_FOUND'});
const conflict = () => appError('integration state does not permit this action', {status:409,code:'INVALID_INTEGRATION_STATE'});
const clockUnavailable = () => appError('integration clock unavailable', {status:503,code:'INTEGRATION_CLOCK_UNAVAILABLE'});
const LEASE_MS=55*60*1000;
function text(value,max=512){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw invalid();return value;}
function options(value,defaults){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))throw invalid();
  return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,descriptors[key]?.value===undefined?fallback:descriptors[key].value]));
}
function mailboxes(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>100)throw invalid();
  const result=[];
  for(let i=0;i<value.length;i++){const descriptor=Object.getOwnPropertyDescriptor(value,String(i));if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid();result.push(text(descriptor.value));}
  return [...new Set(result)];
}

// Synthetic reliability model only; these are not validated live Graph semantics.
export class MockGraphHarness {
  #get;#upsert;#now;
  #subscriptions=new Map();#delta=new Map();#deliveries=new Map();#deliveryFingerprints=new Map();
  constructor(input={}){
    const {registry,tenantId,maxDeliveryAttempts,now}=options(input,{registry:undefined,tenantId:'tenant-demo',maxDeliveryAttempts:3,now:()=>Date.now()});
    text(tenantId,200);if(tenantId.trim()!==tenantId||!Number.isInteger(maxDeliveryAttempts)||maxDeliveryAttempts<1||maxDeliveryAttempts>100||typeof now!=='function'||typeof registry?.get!=='function'||typeof registry?.upsert!=='function')throw invalid();
    this.#get=registry.get.bind(registry);this.#upsert=registry.upsert.bind(registry);this.#now=now;
    Object.defineProperties(this,{tenantId:{value:tenantId,enumerable:true},maxDeliveryAttempts:{value:maxDeliveryAttempts,enumerable:true}});
  }
  #time(){
    try{const millis=this.#now();if(!Number.isSafeInteger(millis)||millis<0||millis>8640000000000000-LEASE_MS)throw Error();return {millis,iso:new Date(millis).toISOString()};}
    catch{throw clockUnavailable();}
  }
  #approvedMailbox(mailboxId){const config=this.#get(this.tenantId,'MICROSOFT_GRAPH');return config?.mode==='MOCK'&&Array.isArray(config.capabilities)&&config.capabilities.includes('MAIL_READ')&&Array.isArray(config.metadata?.mailboxes)&&config.metadata.mailboxes.includes(mailboxId);}
  #requireMailbox(mailboxId){text(mailboxId);if(!this.#approvedMailbox(mailboxId))throw unavailable();}
  #checkpoint(mailboxId){return {mailboxId,checkpointPresent:true,scopeStatus:this.#approvedMailbox(mailboxId)?'IN_SCOPE':'OUT_OF_SCOPE'};}
  #subscription(id){text(id);const item=this.#subscriptions.get(id);if(!item)throw unavailable();this.#requireMailbox(item.mailboxId);return item;}
  #active(sub,time){if(sub.status!=='ACTIVE'||Date.parse(sub.expiration)<=time.millis)throw conflict();}
  #delivery(id){text(id);const item=this.#deliveries.get(id);if(!item)throw unavailable();return {item,sub:this.#subscription(item.subscriptionId)};}
  configure(input={}){
    const config=options(input,{mailboxes:['shared-inbox@example.invalid'],reader:true,writer:false,sender:false});
    if([config.reader,config.writer,config.sender].some(x=>typeof x!=='boolean'))throw invalid();
    const approved=mailboxes(config.mailboxes),caps=[config.reader&&'MAIL_READ',config.writer&&'MAIL_WRITE',config.sender&&'MAIL_SEND'].filter(Boolean),time=this.#time();
    return this.#upsert({tenantId:this.tenantId,kind:'MICROSOFT_GRAPH',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:caps,metadata:{mailboxes:approved,credentialMode:'MOCK_CERT_REF',permissionModel:'SEPARATED_IDENTITIES'},health:{state:'HEALTHY',lastCheck:time.iso}});
  }
  createMailboxSubscription(mailboxId,folder='Inbox'){
    this.#requireMailbox(mailboxId);text(folder,128);const time=this.#time();
    const item={id:`sub_${crypto.randomUUID()}`,tenantId:this.tenantId,mailboxId,folder,status:'ACTIVE',expiration:new Date(time.millis+LEASE_MS).toISOString(),clientStateRef:'secretref://mock/client-state',createdAt:time.iso};
    this.#subscriptions.set(item.id,item);return clone(item);
  }
  renewSubscription(id){
    const item=this.#subscription(id);if(!['ACTIVE','MISSED'].includes(item.status))throw conflict();const time=this.#time();
    Object.assign(item,{expiration:new Date(time.millis+LEASE_MS).toISOString(),status:'ACTIVE',renewedAt:time.iso});return clone(item);
  }
  lifecycle(id,status){
    if(!['ACTIVE','MISSED','REMOVED','AUTHORIZATION_REQUIRED'].includes(status))throw invalid();const item=this.#subscription(id);
    if(status!==item.status&&['REMOVED','AUTHORIZATION_REQUIRED'].includes(item.status))throw conflict();const time=this.#time();
    Object.assign(item,{status,lifecycleAt:time.iso});return clone(item);
  }
  setDelta(mailboxId,token){this.#requireMailbox(mailboxId);text(token,2048);const time=this.#time();this.#delta.set(mailboxId,token);return {...this.#checkpoint(mailboxId),updatedAt:time.iso};}
  receiveNotification(input={}){
    const {subscriptionId,notificationId,resourceId,changeType,clientStateValid}=options(input,{subscriptionId:undefined,notificationId:null,resourceId:'synthetic-resource',changeType:'updated',clientStateValid:true});
    const sub=this.#subscription(subscriptionId);if(notificationId!==null)text(notificationId);text(resourceId);
    if(!['created','updated','deleted'].includes(changeType)||typeof clientStateValid!=='boolean')throw invalid();
    const time=this.#time();this.#active(sub,time);
    const fingerprint=notificationId===null?null:crypto.createHash('sha256').update(JSON.stringify([this.tenantId,subscriptionId,notificationId,resourceId,changeType])).digest('hex');
    if(clientStateValid&&fingerprint&&this.#deliveryFingerprints.has(fingerprint)){
      const existing=this.#deliveries.get(this.#deliveryFingerprints.get(fingerprint));existing.duplicateCount+=1;existing.lastDuplicateAt=time.iso;return {...clone(existing),duplicate:true};
    }
    const item={id:`del_${crypto.randomUUID()}`,tenantId:this.tenantId,subscriptionId,mailboxId:sub.mailboxId,notificationId,resourceId,changeType,fingerprint,status:clientStateValid?'ACCEPTED':'REJECTED_CLIENT_STATE',attempts:0,totalAttempts:0,recoveryCount:0,duplicateCount:0,receivedAt:time.iso,updatedAt:time.iso,lastError:null};
    this.#deliveries.set(item.id,item);if(clientStateValid&&fingerprint)this.#deliveryFingerprints.set(fingerprint,item.id);return {...clone(item),duplicate:false};
  }
  failDelivery(id,error='synthetic delivery failure'){
    text(error,240);const {item,sub}=this.#delivery(id),time=this.#time();this.#active(sub,time);if(item.status!=='ACCEPTED')throw conflict();
    item.attempts+=1;item.totalAttempts+=1;item.lastError='SYNTHETIC_DELIVERY_FAILURE';item.updatedAt=time.iso;item.status=item.attempts>=this.maxDeliveryAttempts?'DEAD_LETTER':'RETRY_SCHEDULED';return clone(item);
  }
  retryDelivery(id){
    const {item,sub}=this.#delivery(id),time=this.#time();this.#active(sub,time);if(!['RETRY_SCHEDULED','DEAD_LETTER'].includes(item.status))throw conflict();
    if(item.status==='DEAD_LETTER'){item.attempts=0;item.recoveryCount+=1;}
    Object.assign(item,{status:'ACCEPTED',lastError:null,updatedAt:time.iso,retriedAt:time.iso});return clone(item);
  }
  #visibleSubscription(item,time){const status=!this.#approvedMailbox(item.mailboxId)?'OUT_OF_SCOPE':item.status==='ACTIVE'&&Date.parse(item.expiration)<=time.millis?'EXPIRED':item.status;return {...clone(item),status};}
  #health(all,time){
    const deliveries=[...this.#deliveries.values()],dead=deliveries.filter(x=>x.status==='DEAD_LETTER').length,retry=deliveries.filter(x=>x.status==='RETRY_SCHEDULED').length,rejected=deliveries.filter(x=>x.status==='REJECTED_CLIENT_STATE').length,lifecycle=all.filter(x=>x.status!=='ACTIVE').length,checkpointAttention=[...this.#delta.keys()].filter(mailbox=>!this.#approvedMailbox(mailbox)).length;
    return {state:dead||retry||lifecycle||checkpointAttention?'DEGRADED':'HEALTHY',mode:'MOCK',subscriptions:all.filter(x=>x.status==='ACTIVE').length,totalSubscriptions:all.length,deltaCheckpoints:this.#delta.size,deliveries:deliveries.length,retryScheduled:retry,deadLetters:dead,rejected,lifecycleAttention:lifecycle,checkpointAttention,lastCheck:time.iso};
  }
  healthCheck(){const time=this.#time(),all=[...this.#subscriptions.values()].map(x=>this.#visibleSubscription(x,time));return this.#health(all,time);}
  snapshot(){const time=this.#time(),subscriptions=[...this.#subscriptions.values()].map(x=>this.#visibleSubscription(x,time));return {subscriptions,deltaCheckpoints:[...this.#delta.keys()].map(mailboxId=>this.#checkpoint(mailboxId)),deliveries:[...this.#deliveries.values()].map(clone).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)),health:this.#health(subscriptions,time)};}
}
