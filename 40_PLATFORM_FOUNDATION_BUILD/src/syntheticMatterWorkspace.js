import {normalizeSession,requireCapability,matterAccessAllowed} from './auth.js';
import {appError} from './errors.js';

// Synthetic read-only matter workspace. Never a production authorisation provider.
const hidden=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const bad=()=>appError('invalid workspace request',{status:400,code:'INVALID_REQUEST'});
const bounded=(n,fallback,max)=>{if(n===undefined)return fallback;if(!Number.isInteger(n)||n<1||n>max)throw bad();return n;};
const identifier=x=>typeof x==='string'&&x.length>0&&x.length<=200&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const copy=value=>structuredClone(value);
export class SyntheticMatterWorkspace {
  #store;#now;
  constructor({store,now=()=>Date.now()}={}){
    if(!store||['getMatter','listMatters','listWork','listEvents'].some(k=>typeof store[k]!=='function'))throw Error('MATTER_WORKSPACE_STORE_REQUIRED');
    if(typeof now!=='function')throw Error('MATTER_WORKSPACE_CLOCK_REQUIRED');
    this.#store=store;this.#now=now;
  }
  #session(raw){const s=normalizeSession(raw);requireCapability(s,'matter:read');return s;}
  #allowed(s,m){return m?.tenantId===s.tenantId&&matterAccessAllowed(s,m,{now:this.#now()});}
  get({session,matterId}={}){
    const s=this.#session(session);
    if(!identifier(matterId))throw hidden();
    const m=this.#store.getMatter(s.tenantId,matterId);
    if(!this.#allowed(s,m))throw hidden();
    return Object.freeze(copy(m));
  }
  list({session,limit=50}={}){
    const s=this.#session(session),n=bounded(limit,50,100);
    // Scan bounded tenant rows and filter before limiting visible results.
    const all=this.#store.listMatters(s.tenantId,500);
    return Object.freeze(all.filter(m=>this.#allowed(s,m)).slice(0,n).map(m=>Object.freeze(copy(m))));
  }
  // Work and event data deliberately remain in their separately authorised services.
  summary({session,matterId}={}){
    const matter=this.get({session,matterId});
    return Object.freeze({matter,syntheticReferenceOnly:true,workAndEventsRequireSeparateAuthorization:true});
  }
}
