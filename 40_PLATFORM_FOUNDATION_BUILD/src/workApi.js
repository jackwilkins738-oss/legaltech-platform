import {appError} from './errors.js';
import {normalizeSession} from './auth.js';
import {WorkCursorCodec} from './workCursor.js';

const MAX_SCAN=1000,SCAN_PAGE=200;
const clone=v=>structuredClone(v);
const boundedInt=(value,{fallback=0,min=0,max=10000}={})=>{const n=value==null?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw appError('invalid pagination',{status:400,code:'INVALID_REQUEST'});return n;};
const hidden=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});

function translate(error){
  if(error?.code&&Number.isInteger(error?.status))throw error;
  const code=typeof error?.message==='string'?error.message:'';
  if(code.includes('UNAVAILABLE')||code.includes('MATTER_UNAVAILABLE'))throw hidden();
  if(code.includes('VERSION_CONFLICT')||code.includes('IDEMPOTENCY_CONFLICT')||code.includes('TRANSITION_INVALID')||code.includes('TERMINAL')||code.includes('DEPENDENCY_ACTIVE')||code.includes('REQUEST_CLOSED'))throw appError('work state changed',{status:409,code:'WORK_CONFLICT'});
  if(code.startsWith('WORK_'))throw appError('invalid work request',{status:400,code:'INVALID_REQUEST'});
  throw error;
}

export class WorkApiService {
  #work;#auth;#cursors;
  constructor({orchestrator,authorizer,cursorCodec=null}={}){
    if(!orchestrator||typeof orchestrator.listQueue!=='function'||typeof orchestrator.createWork!=='function')throw new Error('WORK_API_ORCHESTRATOR_REQUIRED');
    if(!authorizer||typeof authorizer.assertRead!=='function'||typeof authorizer.filterReadable!=='function')throw new Error('WORK_API_AUTHORIZER_REQUIRED');
    if(cursorCodec!==null&&(!cursorCodec||typeof cursorCodec.encode!=='function'||typeof cursorCodec.decode!=='function'))throw new Error('WORK_API_CURSOR_CODEC_INVALID');
    this.#work=orchestrator;this.#auth=authorizer;this.#cursors=cursorCodec??new WorkCursorCodec();
  }
  get({session,workId}){try{return this.#auth.assertRead(session,workId);}catch(e){translate(e);}}
  events({session,workId,limit=200}){try{this.#auth.assertRead(session,workId);return this.#work.events({tenantId:normalizeSession(session).tenantId,workId,limit:Math.max(1,Math.min(Number(limit)||200,200))});}catch(e){translate(e);}}
  list({session,owner=null,states=null,types=null,matterId=null,limit=50,cursor=null}){
    const s=normalizeSession(session),wanted=boundedInt(limit,{fallback:50,min:1,max:100}),filters={owner,states,types,matterId};let scan=0,scanned=0,items=[],exhausted=false;
    try{
      if(cursor!==null){if(typeof cursor!=='string')throw new Error('WORK_CURSOR_INVALID');scan=this.#cursors.decode(cursor,{tenantId:s.tenantId,filters});}
      while(items.length<wanted&&scanned<MAX_SCAN){const pageSize=Math.min(SCAN_PAGE,MAX_SCAN-scanned);const page=this.#work.listQueue({tenantId:s.tenantId,owner,states,types,matterId,limit:pageSize,offset:scan});if(page.length===0){exhausted=true;break;}let consumed=0;for(const item of page){if(items.length>=wanted||scanned>=MAX_SCAN)break;consumed++;scan++;scanned++;const visible=this.#auth.filterReadable(s,[item],{limit:1});if(visible.length)items.push(visible[0]);}if(items.length>=wanted)break;if(consumed===page.length&&page.length<pageSize){exhausted=true;break;}}
      const nextCursor=exhausted?null:this.#cursors.encode({tenantId:s.tenantId,offset:scan,filters});
      return Object.freeze({items:Object.freeze(items),nextCursor});
    }catch(e){translate(e);}
  }
  create({session,input,idempotencyKey,traceId}){const s=normalizeSession(session);try{this.#auth.assertCreate(s,{matterId:input.matterId??null,owner:input.owner});return this.#work.createWork({...input,tenantId:s.tenantId,requesterId:s.actorId,actorId:s.actorId,idempotencyKey,traceId});}catch(e){translate(e);}}
  transition({session,workId,input,traceId}){const s=normalizeSession(session);try{this.#auth.assertUpdate(s,workId);return this.#work.transition({tenantId:s.tenantId,workId,to:input.to,expectedVersion:input.expectedVersion,reason:input.reason,actorId:s.actorId,traceId});}catch(e){translate(e);}}
  respond({session,workId,input,traceId}){const s=normalizeSession(session);try{this.#auth.assertRespond(s,workId);return this.#work.respond({tenantId:s.tenantId,workId,expectedVersion:input.expectedVersion,outcome:input.outcome,comment:input.comment??null,metadata:input.metadata??{},actorId:s.actorId,traceId});}catch(e){translate(e);}}
  assign({session,workId,input,traceId}){const s=normalizeSession(session);try{this.#auth.assertAssign(s,workId);return this.#work.assign({tenantId:s.tenantId,workId,owner:input.owner,expectedVersion:input.expectedVersion,reason:input.reason,actorId:s.actorId,traceId});}catch(e){translate(e);}}
}
