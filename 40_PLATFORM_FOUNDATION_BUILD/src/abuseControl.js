import {appError} from './errors.js';

function positiveInt(value,fallback,{min=1,max=1_000_000}={}){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;
}

export class InMemoryAbuseLimiter {
  #entries=new Map();
  constructor({windowMs=60_000,maxPerIp=300,maxPerTenant=1_000,now=()=>Date.now()}={}){
    this.windowMs=positiveInt(windowMs,60_000,{min:1_000,max:3_600_000});
    this.maxPerIp=positiveInt(maxPerIp,300);
    this.maxPerTenant=positiveInt(maxPerTenant,1_000);
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
}
