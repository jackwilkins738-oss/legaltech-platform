import crypto from 'node:crypto';

export class MockGraphHarness {
  constructor({registry,tenantId='tenant-demo'}={}) { this.registry=registry; this.tenantId=tenantId; this.subscriptions=new Map(); this.delta=new Map(); }
  configure({mailboxes=['shared-inbox@example.invalid'],reader=true,writer=false,sender=false}={}) {
    const caps=[reader&&'MAIL_READ',writer&&'MAIL_WRITE',sender&&'MAIL_SEND'].filter(Boolean);
    return this.registry.upsert({tenantId:this.tenantId,kind:'MICROSOFT_GRAPH',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:caps,metadata:{mailboxes,credentialMode:'MOCK_CERT_REF',permissionModel:'SEPARATED_IDENTITIES'},health:{state:'HEALTHY',lastCheck:new Date().toISOString()}});
  }
  createMailboxSubscription(mailboxId,folder='Inbox') { const id=`sub_${crypto.randomUUID()}`; const item={id,mailboxId,folder,status:'ACTIVE',expiration:new Date(Date.now()+55*60*1000).toISOString(),clientStateRef:'secretref://mock/client-state',createdAt:new Date().toISOString()};this.subscriptions.set(id,item);return structuredClone(item); }
  renewSubscription(id){const x=this.subscriptions.get(id);if(!x)throw new Error('subscription missing');x.expiration=new Date(Date.now()+55*60*1000).toISOString();x.status='ACTIVE';x.renewedAt=new Date().toISOString();return structuredClone(x);}
  lifecycle(id,status){const x=this.subscriptions.get(id);if(!x)throw new Error('subscription missing');x.status=status;x.lifecycleAt=new Date().toISOString();return structuredClone(x);}
  setDelta(mailboxId,token){this.delta.set(mailboxId,token);return {mailboxId,deltaCheckpoint:token,updatedAt:new Date().toISOString()};}
  healthCheck(){const active=[...this.subscriptions.values()].filter(x=>x.status==='ACTIVE');return {state:'HEALTHY',mode:'MOCK',subscriptions:active.length,totalSubscriptions:this.subscriptions.size,deltaCheckpoints:this.delta.size,lastCheck:new Date().toISOString()};}
  snapshot(){return {subscriptions:[...this.subscriptions.values()].map(x=>structuredClone(x)),deltaCheckpoints:[...this.delta.entries()].map(([mailboxId,token])=>({mailboxId,token})),health:this.healthCheck()};}
}
