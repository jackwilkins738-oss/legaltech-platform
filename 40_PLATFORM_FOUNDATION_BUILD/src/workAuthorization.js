import {appError} from './errors.js';
import {normalizeSession,matterAccessAllowed,requireCapability,requireRecentStepUp} from './auth.js';

export const WORK_CAPABILITIES=Object.freeze([
  'work:read:self','work:read:any','work:create','work:update:self','work:update:any',
  'work:respond:self','work:respond:any','work:assign','work:flow:read','work:policy:manage',
]);

const invisible=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const clone=value=>structuredClone(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
const ownerValid=value=>value&&typeof value==='object'&&['USER','ROLE','TEAM','POOL'].includes(value.kind)&&id(value.id);

function has(session,capability){return session.capabilities.includes(capability);}
export class WorkAuthorizer {
  #store;#now;#membershipResolver;
  constructor({store,now=()=>Date.now(),membershipResolver=null}={}){
    if(!store||typeof store.getWork!=='function'||typeof store.getMatter!=='function')throw new Error('WORK_AUTH_STORE_REQUIRED');
    if(typeof now!=='function')throw new Error('WORK_AUTH_CLOCK_REQUIRED');
    if(membershipResolver!==null&&typeof membershipResolver?.isMember!=='function')throw new Error('WORK_AUTH_MEMBERSHIP_RESOLVER_INVALID');
    this.#store=store;this.#now=now;this.#membershipResolver=membershipResolver;
  }
  #session(raw){return normalizeSession(raw);}
  #matterAllowed(session,matterId){
    if(matterId==null)return true;
    const matter=this.#store.getMatter(session.tenantId,matterId);
    return Boolean(matter&&matterAccessAllowed(session,matter,{now:this.#now()}));
  }
  #visibleWork(session,workId){
    if(!id(workId))throw invisible();
    const work=this.#store.getWork(session.tenantId,workId);
    if(!work||work.tenantId!==session.tenantId||!this.#matterAllowed(session,work.matterId))throw invisible();
    return work;
  }
  #selfOwner(session,owner){
    if(!ownerValid(owner))return false;
    if(owner.kind==='USER')return owner.id===session.actorId;
    if(owner.kind==='ROLE')return session.roles.includes(owner.id);
    if(!this.#membershipResolver)return false;
    try{return this.#membershipResolver.isMember({tenantId:session.tenantId,actorId:session.actorId,owner,at:new Date(this.#now()).toISOString()})===true;}catch{return false;}
  }
  #readableBySelf(session,work){return work.requesterId===session.actorId||this.#selfOwner(session,work.owner);}
  #readAllowed(session,work){return has(session,'work:read:any')||(has(session,'work:read:self')&&this.#readableBySelf(session,work));}
  #updateAllowed(session,work){return has(session,'work:update:any')||(has(session,'work:update:self')&&this.#selfOwner(session,work.owner));}
  #respondAllowed(session,work){return has(session,'work:respond:any')||(has(session,'work:respond:self')&&this.#selfOwner(session,work.owner));}

  assertRead(rawSession,workId){const session=this.#session(rawSession),work=this.#visibleWork(session,workId);if(!this.#readAllowed(session,work))throw invisible();return Object.freeze(clone(work));}
  assertUpdate(rawSession,workId){const session=this.#session(rawSession),work=this.#visibleWork(session,workId);if(!this.#updateAllowed(session,work))throw invisible();return Object.freeze(clone(work));}
  assertRespond(rawSession,workId){const session=this.#session(rawSession),work=this.#visibleWork(session,workId);if(!this.#respondAllowed(session,work))throw invisible();return Object.freeze(clone(work));}
  assertAssign(rawSession,workId){const session=this.#session(rawSession),work=this.#visibleWork(session,workId);requireCapability(session,'work:assign');return Object.freeze(clone(work));}
  assertCreate(rawSession,{matterId=null,owner}={}){
    const session=this.#session(rawSession);requireCapability(session,'work:create');
    if(!ownerValid(owner))throw appError('invalid work owner',{status:400,code:'WORK_OWNER_INVALID'});
    if(!this.#matterAllowed(session,matterId))throw invisible();
    if(!this.#selfOwner(session,owner))requireCapability(session,'work:assign');
    return Object.freeze({tenantId:session.tenantId,actorId:session.actorId,matterId,owner:clone(owner)});
  }
  assertFlowRead(rawSession){const session=this.#session(rawSession);requireCapability(session,'work:flow:read');return Object.freeze({tenantId:session.tenantId,actorId:session.actorId});}
  assertPolicyManage(rawSession,{requireStepUp=true,maxAgeMs=5*60*1000}={}){const session=this.#session(rawSession);requireCapability(session,'work:policy:manage');if(requireStepUp)requireRecentStepUp(session,{now:this.#now(),maxAgeMs});return Object.freeze({tenantId:session.tenantId,actorId:session.actorId});}
  filterReadable(rawSession,items,{limit=200}={}){
    const session=this.#session(rawSession);if(!Array.isArray(items))throw new Error('WORK_AUTH_ITEMS_REQUIRED');const cap=Math.max(1,Math.min(Number(limit)||200,500));
    const result=[];for(const work of items){if(result.length>=cap)break;if(!work||work.tenantId!==session.tenantId||!this.#matterAllowed(session,work.matterId)||!this.#readAllowed(session,work))continue;result.push(Object.freeze(clone(work)));}return Object.freeze(result);
  }
}
