import {randomUUID} from 'node:crypto';
import {normalizeSession,requireCapability,matterAccessAllowed} from './auth.js';
import {appError} from './errors.js';

const hidden=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const invalid=()=>appError('invalid communication request',{status:400,code:'INVALID_REQUEST'});
const id=x=>typeof x==='string'&&x.length>0&&x.length<=200&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=4000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
const own=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;};
const object=o=>o!==null&&typeof o==='object'&&(Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
const safe=o=>{if(!object(o)||Reflect.ownKeys(o).some(k=>typeof k!=='string'||!Object.getOwnPropertyDescriptor(o,k)?.enumerable))throw invalid();return o;};
const clone=x=>structuredClone(x);

/** Explicitly synthetic, process-local communications reference. No network or production persistence. */
export class SyntheticMatterCommunications {
  #matters;#now;#threads=new Map();#messages=new Map();#maxThreads;#maxMessages;
  constructor({matterStore,now=()=>new Date().toISOString(),maxThreads=1000,maxMessages=2000}={}){
    if(!matterStore||typeof matterStore.getMatter!=='function'||typeof now!=='function')throw Error('COMMUNICATION_CONFIGURATION_INVALID');
    if(!Number.isInteger(maxThreads)||maxThreads<1||maxThreads>10000||!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>10000)throw Error('COMMUNICATION_CONFIGURATION_INVALID');
    this.#matters=matterStore;this.#now=now;this.#maxThreads=maxThreads;this.#maxMessages=maxMessages;
  }
  #session(raw,cap){const s=normalizeSession(raw);requireCapability(s,cap);return s;}
  #matter(s,matterId){
    if(!id(matterId))throw hidden();
    const matter=this.#matters.getMatter(s.tenantId,matterId);
    if(!matter||!matterAccessAllowed(s,matter))throw hidden();
    return matter;
  }
  createThread({session,input}={}){
    const s=this.#session(session,'matter:communicate'),v=safe(input);
    if(Reflect.ownKeys(v).some(k=>!['matterId','subject','participantIds'].includes(k)))throw invalid();
    const matterId=own(v,'matterId'),subject=own(v,'subject'),participants=own(v,'participantIds');
    this.#matter(s,matterId);
    if(!text(subject)||subject.length>200||!Array.isArray(participants)||Object.getPrototypeOf(participants)!==Array.prototype||participants.length>25||participants.some(x=>!id(x)))throw invalid();
    const ids=[...new Set([...participants,s.actorId])];
    if(this.#threads.size>=this.#maxThreads)throw appError('communication capacity reached',{status:429,code:'COMMUNICATION_CAPACITY'});
    const at=this.#now();if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('COMMUNICATION_CLOCK_INVALID');
    const thread=Object.freeze({id:randomUUID(),tenantId:s.tenantId,matterId,subject,participantIds:Object.freeze(ids),createdBy:s.actorId,createdAt:at});
    this.#threads.set(thread.id,thread);this.#messages.set(thread.id,[]);
    return Object.freeze(clone(thread));
  }
  #thread(session,threadId,cap){
    const s=this.#session(session,cap);
    if(!id(threadId))throw hidden();
    const t=this.#threads.get(threadId);
    if(!t||t.tenantId!==s.tenantId||!t.participantIds.includes(s.actorId))throw hidden();
    this.#matter(s,t.matterId);
    return {s,t};
  }
  post({session,threadId,body}={}){
    const {s,t}=this.#thread(session,threadId,'matter:communicate');
    if(!text(body))throw invalid();
    if(this.#messages.get(t.id).length>=this.#maxMessages)throw appError('communication capacity reached',{status:429,code:'COMMUNICATION_CAPACITY'});
    const at=this.#now();if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('COMMUNICATION_CLOCK_INVALID');
    const message=Object.freeze({id:randomUUID(),threadId:t.id,actorId:s.actorId,body,at});
    this.#messages.get(t.id).push(message);
    return Object.freeze(clone(message));
  }
  replaceParticipants({session,threadId,participantIds}={}){
    const {s,t}=this.#thread(session,threadId,'matter:communicate');
    if(t.createdBy!==s.actorId)throw hidden();
    if(!Array.isArray(participantIds)||Object.getPrototypeOf(participantIds)!==Array.prototype||participantIds.length>25||participantIds.some(x=>!id(x)))throw invalid();
    const ids=Object.freeze([...new Set([...participantIds,t.createdBy])]);
    const replacement=Object.freeze({...t,participantIds:ids});
    this.#threads.set(t.id,replacement);
    return Object.freeze(clone(replacement));
  }
  listThreads({session,matterId,limit=50}={}){
    const s=this.#session(session,'matter:communicate:read');
    this.#matter(s,matterId);
    if(!Number.isInteger(limit)||limit<1||limit>100)throw invalid();
    return Object.freeze([...this.#threads.values()].filter(t=>t.tenantId===s.tenantId&&t.matterId===matterId&&t.participantIds.includes(s.actorId)).slice(0,limit).map(t=>Object.freeze(clone(t))));
  }
  messages({session,threadId,limit=100}={}){
    const {t}=this.#thread(session,threadId,'matter:communicate:read');
    if(!Number.isInteger(limit)||limit<1||limit>200)throw invalid();
    return Object.freeze(this.#messages.get(t.id).slice(-limit).map(m=>Object.freeze(clone(m))));
  }
}
