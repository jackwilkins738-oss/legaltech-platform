// Metadata stays in memory. No browser storage, bearer token input or automatic writes.
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=['eventId','status','resultJobId','resultHash','resultCode','artifactHash','decision','matterId','writebackJobId'];
function exact(v,names){return v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));}
export function reviewItem(v){
  if(!exact(v,keys)||!uuid(v.eventId)||!uuid(v.resultJobId)||!hash(v.resultHash)||!hash(v.artifactHash)||(typeof v.resultCode!=='string'||!/^([A-Z][A-Z0-9_]{0,63})$/.test(v.resultCode)))throw Error('INVALID_RESPONSE');
  const pending=v.status==='PROCESSED'&&v.decision===null&&v.matterId===null&&v.writebackJobId===null;
  const approved=v.status==='APPROVED'&&v.decision==='APPROVE'&&uuid(v.matterId)&&uuid(v.writebackJobId);
  const rejected=v.status==='REJECTED'&&v.decision==='REJECT'&&v.matterId===null&&v.writebackJobId===null;
  if(!pending&&!approved&&!rejected)throw Error('INVALID_RESPONSE');return Object.freeze({...v});
}
export class ReviewClient {
  #fetch;#key;#change;#timeout;#state={items:[],nextCursor:null,status:'PENDING',selected:null,busy:false,error:null,pending:null,receipt:null};#version=0;#disposed=false;
  constructor({fetchImpl=globalThis.fetch.bind(globalThis),randomUUID=()=>globalThis.crypto.randomUUID(),onChange=()=>{},timeoutMs=12000}={}){
    if(typeof fetchImpl!=='function'||typeof randomUUID!=='function'||typeof onChange!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw Error('CONFIGURATION_INVALID');this.#fetch=fetchImpl;this.#key=randomUUID;this.#change=onChange;this.#timeout=timeoutMs;
  }
  state(){return Object.freeze({...this.#state,items:Object.freeze([...this.#state.items])});}
  #emit(){if(!this.#disposed)this.#change(this.state());}
  #start(){if(this.#disposed||this.#state.busy)throw Error('BUSY');this.#state.busy=true;this.#state.error=null;this.#emit();return ++this.#version;}
  async #request(path,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
    try{const r=await this.#fetch(path,{...options,credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      if(!r.ok){const e=Error(r.status===401?'SIGN_IN_REQUIRED':r.status===404?'UNAVAILABLE':r.status===409?'CONFLICT':r.status>=500?'OUTCOME_UNKNOWN':'INVALID_REQUEST');throw e;}
      if(!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??''))throw Error('INVALID_RESPONSE');return await r.json();
    }finally{clearTimeout(timer);}
  }
  #fail(error,write=false){const known=['SIGN_IN_REQUIRED','UNAVAILABLE','CONFLICT','INVALID_REQUEST'];this.#state.error=known.includes(error.message)?error.message:write?'OUTCOME_UNKNOWN':'READ_UNAVAILABLE';this.#state.items=[];this.#state.selected=null;this.#state.nextCursor=null;this.#state.receipt=null;}
  async list({status=this.#state.status,next=false}={}){
    if(this.#state.pending)throw Error('RETRY_REQUIRED');if(!['PENDING','DECIDED','ALL'].includes(status)||next&&(!this.#state.nextCursor||status!==this.#state.status))throw Error('INVALID_REQUEST');
    const cursor=next?this.#state.nextCursor:null,version=this.#start();this.#state.selected=null;this.#state.items=[];this.#state.receipt=null;
    try{const q=new URLSearchParams({status,limit:'25'});if(cursor)q.set('cursor',cursor);const v=await this.#request('/api/v1/processing/reviews?'+q);
      if(!exact(v,['items','nextCursor'])||!Array.isArray(v.items)||v.items.length>25||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!v.nextCursor||v.nextCursor.length>1600))throw Error('INVALID_RESPONSE');
      const items=v.items.map(reviewItem);if(new Set(items.map(x=>x.eventId)).size!==items.length||items.some(x=>status==='PENDING'&&x.status!=='PROCESSED'||status==='DECIDED'&&x.status==='PROCESSED'))throw Error('INVALID_RESPONSE');
      if(version===this.#version&&!this.#disposed)Object.assign(this.#state,{items,nextCursor:v.nextCursor,status});
    }catch(e){if(version===this.#version)this.#fail(e);}finally{if(version===this.#version){this.#state.busy=false;this.#emit();}}
  }
  async select(eventId){
    if(this.#state.pending)throw Error('RETRY_REQUIRED');if(!uuid(eventId)||!this.#state.items.some(x=>x.eventId===eventId))throw Error('INVALID_REQUEST');const version=this.#start();this.#state.selected=null;this.#state.receipt=null;
    try{const v=reviewItem(await this.#request('/api/v1/processing/reviews/'+eventId));if(v.eventId!==eventId)throw Error('INVALID_RESPONSE');if(version===this.#version&&!this.#disposed)this.#state.selected=v;
    }catch(e){if(version===this.#version)this.#fail(e);}finally{if(version===this.#version){this.#state.busy=false;this.#emit();}}
  }
  async decide({decision,matterId=null,sourceReviewed=false}={}){
    const item=this.#state.selected;if(this.#state.pending)throw Error('RETRY_REQUIRED');if(!item||item.status!=='PROCESSED'||sourceReviewed!==true||!['APPROVE','REJECT'].includes(decision)||decision==='APPROVE'&&!uuid(matterId)||decision==='REJECT'&&matterId!==null)throw Error('INVALID_REQUEST');
    const key=this.#key();if(!uuid(key))throw Error('INVALID_REQUEST');this.#state.pending=Object.freeze({eventId:item.eventId,decision,matterId,decisionKey:'browser:'+key,expectedResultJobId:item.resultJobId,expectedResultHash:item.resultHash});return this.retry();
  }
  async retry(){
    if(!this.#state.pending)throw Error('INVALID_REQUEST');const version=this.#start(),r=this.#state.pending;
    try{const v=await this.#request('/api/v1/processing/review-decisions',{method:'POST',headers:{'content-type':'application/json','x-review-ui':'1','idempotency-key':r.decisionKey},body:JSON.stringify(r)});
      if(!exact(v,['eventId','decision','matterId','resultJobId','resultHash','writebackJobId','status','replayed'])||['eventId','decision','matterId'].some(k=>v[k]!==r[k])||v.resultJobId!==r.expectedResultJobId||v.resultHash!==r.expectedResultHash||v.status!=='DECIDED'||typeof v.replayed!=='boolean'||r.decision==='APPROVE'&&!uuid(v.writebackJobId)||r.decision==='REJECT'&&v.writebackJobId!==null)throw Error('INVALID_RESPONSE');
      if(version===this.#version&&!this.#disposed)Object.assign(this.#state,{pending:null,selected:null,items:[],nextCursor:null,receipt:Object.freeze({...v})});
    }catch(e){if(version===this.#version){this.#fail(e,true);if(['CONFLICT','INVALID_REQUEST'].includes(e.message))this.#state.pending=null;}}
    finally{if(version===this.#version){this.#state.busy=false;this.#emit();}}
  }
  // Closing forgets the in-memory retry key; it does not prove a cancelled write.
  dispose(){this.#disposed=true;this.#version++;this.#state={items:[],nextCursor:null,status:'PENDING',selected:null,busy:false,error:null,pending:null,receipt:null};}
}
