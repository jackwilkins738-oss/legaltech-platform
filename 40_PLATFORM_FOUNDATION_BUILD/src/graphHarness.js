import crypto from 'node:crypto';

const clone = (x) => structuredClone(x);

export class MockGraphHarness {
  constructor({registry,tenantId='tenant-demo',maxDeliveryAttempts=3}={}) {
    this.registry=registry;
    this.tenantId=tenantId;
    this.maxDeliveryAttempts=maxDeliveryAttempts;
    this.subscriptions=new Map();
    this.delta=new Map();
    this.deliveries=new Map();
    this.deliveryFingerprints=new Map();
  }
  configure({mailboxes=['shared-inbox@example.invalid'],reader=true,writer=false,sender=false}={}) {
    const caps=[reader&&'MAIL_READ',writer&&'MAIL_WRITE',sender&&'MAIL_SEND'].filter(Boolean);
    return this.registry.upsert({tenantId:this.tenantId,kind:'MICROSOFT_GRAPH',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:caps,metadata:{mailboxes,credentialMode:'MOCK_CERT_REF',permissionModel:'SEPARATED_IDENTITIES'},health:{state:'HEALTHY',lastCheck:new Date().toISOString()}});
  }
  createMailboxSubscription(mailboxId,folder='Inbox') {
    const id=`sub_${crypto.randomUUID()}`;
    const item={id,mailboxId,folder,status:'ACTIVE',expiration:new Date(Date.now()+55*60*1000).toISOString(),clientStateRef:'secretref://mock/client-state',createdAt:new Date().toISOString()};
    this.subscriptions.set(id,item);return clone(item);
  }
  renewSubscription(id){const x=this.subscriptions.get(id);if(!x)throw new Error('subscription missing');x.expiration=new Date(Date.now()+55*60*1000).toISOString();x.status='ACTIVE';x.renewedAt=new Date().toISOString();return clone(x);}
  lifecycle(id,status){const x=this.subscriptions.get(id);if(!x)throw new Error('subscription missing');if(!['ACTIVE','MISSED','REMOVED','AUTHORIZATION_REQUIRED'].includes(status))throw new Error('invalid lifecycle status');x.status=status;x.lifecycleAt=new Date().toISOString();return clone(x);}
  setDelta(mailboxId,token){this.delta.set(mailboxId,token);return {mailboxId,deltaCheckpoint:token,updatedAt:new Date().toISOString()};}
  receiveNotification({subscriptionId,notificationId=null,resourceId='synthetic-resource',changeType='updated',clientStateValid=true}={}) {
    const sub=this.subscriptions.get(subscriptionId);if(!sub)throw new Error('subscription missing');
    const fingerprint=crypto.createHash('sha256').update([subscriptionId,notificationId||resourceId,changeType].join('|')).digest('hex');
    const existingId=this.deliveryFingerprints.get(fingerprint);
    if(existingId){const existing=this.deliveries.get(existingId);existing.duplicateCount=(existing.duplicateCount||0)+1;existing.lastDuplicateAt=new Date().toISOString();return {...clone(existing),duplicate:true};}
    const now=new Date().toISOString();
    const item={id:`del_${crypto.randomUUID()}`,subscriptionId,mailboxId:sub.mailboxId,notificationId,resourceId,changeType,fingerprint,status:clientStateValid?'ACCEPTED':'REJECTED_CLIENT_STATE',attempts:0,duplicateCount:0,receivedAt:now,updatedAt:now,lastError:null};
    this.deliveries.set(item.id,item);this.deliveryFingerprints.set(fingerprint,item.id);return {...clone(item),duplicate:false};
  }
  failDelivery(id,error='synthetic delivery failure') {
    const item=this.deliveries.get(id);if(!item)throw new Error('delivery missing');
    item.attempts+=1;item.lastError=String(error).slice(0,240);item.updatedAt=new Date().toISOString();
    item.status=item.attempts>=this.maxDeliveryAttempts?'DEAD_LETTER':'RETRY_SCHEDULED';
    return clone(item);
  }
  retryDelivery(id) {
    const item=this.deliveries.get(id);if(!item)throw new Error('delivery missing');
    if(!['RETRY_SCHEDULED','DEAD_LETTER'].includes(item.status))throw new Error('delivery not retryable');
    item.status='ACCEPTED';item.lastError=null;item.updatedAt=new Date().toISOString();item.retriedAt=item.updatedAt;return clone(item);
  }
  healthCheck(){
    const all=[...this.subscriptions.values()],active=all.filter(x=>x.status==='ACTIVE');
    const dead=[...this.deliveries.values()].filter(x=>x.status==='DEAD_LETTER').length;
    const retry=[...this.deliveries.values()].filter(x=>x.status==='RETRY_SCHEDULED').length;
    const lifecycle=all.filter(x=>x.status!=='ACTIVE').length;
    return {state:(dead||lifecycle)?'DEGRADED':'HEALTHY',mode:'MOCK',subscriptions:active.length,totalSubscriptions:all.length,deltaCheckpoints:this.delta.size,deliveries:this.deliveries.size,retryScheduled:retry,deadLetters:dead,lifecycleAttention:lifecycle,lastCheck:new Date().toISOString()};
  }
  snapshot(){return {subscriptions:[...this.subscriptions.values()].map(clone),deltaCheckpoints:[...this.delta.entries()].map(([mailboxId,token])=>({mailboxId,token})),deliveries:[...this.deliveries.values()].map(clone).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)),health:this.healthCheck()};}
}
