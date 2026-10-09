import {appError} from './errors.js';

function positiveInt(value,fallback,{min=1,max=1_000_000}={}){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;
}

export class InMemoryAbuseLimiter {
  #entries=new Map();#readEntries=new Map();
  constructor({windowMs=60_000,maxPerIp=300,maxPerTenant=1_000,maxReadRecordsPerActor=10_000,maxDistinctMattersPerActor=2_000,now=()=>Date.now()}={}){
    this.windowMs=positiveInt(windowMs,60_000,{min:1_000,max:3_600_000});
    this.maxPerIp=positiveInt(maxPerIp,300);
    this.maxPerTenant=positiveInt(maxPerTenant,1_000);
    this.maxReadRecordsPerActor=positiveInt(maxReadRecordsPerActor,10_000,{min:1,max:1_000_000});
    this.maxDistinctMattersPerActor=positiveInt(maxDistinctMattersPerActor,2_000,{min:1,max:100_000});
    this.now=now;
  }
  #consume(scope,key,limit){
    const now=this.now(),id=`${scope}:${key}`;let entry=this.#entries.get(id);
    if(!entry||now-entry.startedAt>=this.windowMs){entry={startedAt:now,count:0};this.#entries.set(id,entry);}
    entry.count+=1;
    if(entry.count>limit)throw appError('request rate limit exceeded',{status:429,code:'RATE_LIMITED'});
    if(this.#entries.size>10_000){for(const [k,v] of this.#entries)if(now-v.startedAt>=this.windowMs)this.#entries.delete(k);}
  }
  checkIp(req){const key=req?.socket?.remoteAddress||'unknown';this.#consume('ip',key,this.maxPerIp);}
  checkTenant(session){if(session?.tenantId)this.#consume('tenant',session.tenantId,this.maxPerTenant);}
  checkRead(session,{resource,count=0,matterIds=[]}={}){
    if(!session||typeof session.tenantId!=='string'||!session.tenantId||typeof session.actorId!=='string'||!session.actorId)throw appError('invalid read budget context',{status:500,code:'READ_BUDGET_CONTEXT_INVALID'});
    if(typeof resource!=='string'||!/^[a-z0-9:-]{1,64}$/.test(resource))throw appError('invalid read budget resource',{status:500,code:'READ_BUDGET_CONTEXT_INVALID'});
    const n=Number(count);if(!Number.isSafeInteger(n)||n<0||n>10_000||!Array.isArray(matterIds)||matterIds.length>10_000)throw appError('invalid read budget volume',{status:500,code:'READ_BUDGET_CONTEXT_INVALID'});
    const now=this.now(),key=`${session.tenantId}:${session.actorId}`;let entry=this.#readEntries.get(key);
    if(!entry||now-entry.startedAt>=this.windowMs){entry={startedAt:now,count:0,matters:new Set()};this.#readEntries.set(key,entry);}
    const nextCount=entry.count+n;const nextMatters=new Set(entry.matters);
    for(const matterId of matterIds){if(typeof matterId!=='string'||!matterId||matterId.length>256||/[\u0000-\u001f\u007f]/.test(matterId))throw appError('invalid read budget matter',{status:500,code:'READ_BUDGET_CONTEXT_INVALID'});nextMatters.add(matterId);}
    if(nextCount>this.maxReadRecordsPerActor||nextMatters.size>this.maxDistinctMattersPerActor)throw appError('read volume limit exceeded',{status:429,code:'READ_VOLUME_LIMITED'});
    entry.count=nextCount;entry.matters=nextMatters;
    if(this.#readEntries.size>10_000){for(const [k,v] of this.#readEntries)if(now-v.startedAt>=this.windowMs)this.#readEntries.delete(k);}
  }
}
