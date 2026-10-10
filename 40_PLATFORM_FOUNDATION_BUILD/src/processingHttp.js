import {isManagedReviewReads} from './managedReviewReads.js';
import {isManagedReviewDecisions} from './managedReviewDecisions.js';
import {isManagedGraphWebhookIntake} from './managedGraphWebhookIntake.js';
import {graphValidationResponse} from './graphWebhookIngress.js';
import http from 'node:http';
import crypto from 'node:crypto';
import {isUtf8} from 'node:buffer';
import {normalizeSession,requireCapability,StaticAuthProvider} from './auth.js';
import {InMemoryAbuseLimiter} from './abuseControl.js';
import {usesReferenceSessionStore} from './productionIdentity.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {appError,publicError} from './errors.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalid=()=>appError('invalid request',{code:'INVALID_REQUEST'});
const notReady=()=>appError('processing unavailable',{status:503,code:'NOT_READY'});
function shape(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw invalid();}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw invalid();return value;}
function hash(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw invalid();return value;}
function body(req,signal,max){return new Promise((resolve,reject)=>{
  const chunks=[];let length=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;req.off('data',data);req.off('end',end);req.off('error',errorHandler);signal.removeEventListener('abort',abort);for(const c of chunks)c.fill(0);if(error){req.resume();reject(error);}else resolve(value);};
  const data=chunk=>{length+=chunk.length;if(length>max)return finish(invalid());chunks.push(Buffer.from(chunk));};
  const end=()=>{const bytes=Buffer.concat(chunks);try{if(!isUtf8(bytes))throw invalid();const value=JSON.parse(bytes.toString('utf8'));finish(null,value);}catch{finish(invalid());}finally{bytes.fill(0);}};
  const errorHandler=()=>finish(invalid()),abort=()=>finish(notReady());
  req.on('data',data);req.on('end',end);req.on('error',errorHandler);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
function send(res,status,payload,traceId){if(res.destroyed||res.writableEnded)return;const bytes=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(bytes),'cache-control':'no-store','x-content-type-options':'nosniff','x-trace-id':traceId});res.end(bytes);}
function headers(req){const counts=new Map();for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i].toLowerCase();if(['authorization','cookie','idempotency-key','content-type','content-length','transfer-encoding'].includes(name)){counts.set(name,(counts.get(name)??0)+1);if(counts.get(name)>1)throw invalid();}}
  if(req.headers['content-encoding']!==undefined)throw invalid();}
function receipt(value,expected){shape(value,['tenantId','commandId','jobId','kind','objectId','status','replayed']);
  if(Object.entries(expected).some(([k,v])=>value[k]!==v)||value.status!=='ACCEPTED'||typeof value.replayed!=='boolean')throw new Error('PROCESSING_RECEIPT_UNVERIFIED');
  return Object.freeze({commandId:value.commandId,jobId:value.jobId,objectId:value.objectId,status:'ACCEPTED',replayed:value.replayed});}

// Dedicated metadata command API. It never falls back to the synthetic platform
// or exposes worker, adoption, provider, drain-admin or raw result endpoints.
export function createProcessingHttp({handlers,authProvider,abuseLimiter,readiness,drain,authorizeRequest,audit,accepting=()=>true,
  requestTimeoutMs=10000,readinessTimeoutMs=1500,maxBodyBytes=16384,maxInFlight=100,allowDirectCommands=true,graphIntake,reviewIntake,reviewReads,maxGraphBodyBytes=256*1024}={}){
  if(!isProductionReadiness(readiness)||!isManagedDeploymentDrain(drain)||['registerInbound','requestPolicyEvaluation'].some(k=>typeof handlers?.[k]!=='function')
    ||typeof authProvider?.authenticate!=='function'||authProvider instanceof StaticAuthProvider||usesReferenceSessionStore(authProvider)
    ||abuseLimiter instanceof InMemoryAbuseLimiter||['checkIp','checkTenant'].some(k=>typeof abuseLimiter?.[k]!=='function')
    ||typeof authorizeRequest!=='function'||typeof audit!=='function'||typeof accepting!=='function'||typeof allowDirectCommands!=='boolean'||graphIntake!==undefined&&!isManagedGraphWebhookIntake(graphIntake)||reviewIntake!==undefined&&!isManagedReviewDecisions(reviewIntake)||reviewReads!==undefined&&!isManagedReviewReads(reviewReads))throw new Error('PROCESSING_HTTP_CONFIGURATION_INVALID');
  for(const [v,min,max] of [[maxGraphBodyBytes,1024,1024*1024],[requestTimeoutMs,100,60000],[readinessTimeoutMs,100,6000],[maxBodyBytes,1024,65536],[maxInFlight,1,1000]])if(!Number.isInteger(v)||v<min||v>max)throw new Error('PROCESSING_HTTP_CONFIGURATION_INVALID');
  const graphReceive=graphIntake?.receive.bind(graphIntake),reviewDecide=reviewIntake?.decide.bind(reviewIntake),reviewList=reviewReads?.list.bind(reviewReads),reviewGet=reviewReads?.get.bind(reviewReads);
  const bound=Object.freeze({registerInbound:handlers.registerInbound.bind(handlers),requestPolicyEvaluation:handlers.requestPolicyEvaluation.bind(handlers),authenticate:authProvider.authenticate.bind(authProvider),checkIp:abuseLimiter.checkIp.bind(abuseLimiter),checkTenant:abuseLimiter.checkTenant.bind(abuseLimiter)});
  const pending=new Set(),controllers=new Set();let closed=false,uncertain=false;
  const available=()=>{try{return !closed&&!uncertain&&accepting()===true;}catch{return false;}};
  const check=signal=>{if(signal.aborted||!available())throw notReady();};
  const admitted=async signal=>{check(signal);if(await boundedReadinessStatus(readiness,readinessTimeoutMs)!=='READY')throw notReady();check(signal);};
  const server=http.createServer((req,res)=>{
    const traceId=`trc_${crypto.randomUUID()}`;
    // Operational probes remain reachable without acquiring a business lease.
    if(req.method==='GET'&&req.url==='/api/v1/health')return send(res,200,{status:'ok'},traceId);
    if(req.method==='GET'&&req.url==='/api/v1/ready'){
      boundedReadinessStatus(readiness,readinessTimeoutMs).then(state=>{const ready=state==='READY'&&available();send(res,ready?200:503,{status:ready?'READY':'NOT_READY'},traceId);},()=>send(res,503,{status:'NOT_READY'},traceId));return;
    }
    if(!available()||pending.size>=maxInFlight){req.resume();return send(res,503,{status:'NOT_READY'},traceId);}
    const controller=new AbortController(),signal=controller.signal;controllers.add(controller);
    const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
    const timer=setTimeout(()=>{controller.abort();send(res,503,{status:'OUTCOME_UNVERIFIED'},traceId);},requestTimeoutMs);
    const task=Promise.resolve().then(async()=>{
      let lease,committing=false,accepted=false;
      try{
        headers(req);check(signal);await bound.checkIp(req);check(signal);
        const url=new URL(req.url,'http://processing.invalid');
        if(req.method==='POST'&&url.pathname==='/api/v1/integrations/graph/webhooks'){
          if(!graphReceive)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
          if(url.searchParams.has('validationToken')){
            if([...url.searchParams.keys()].some(k=>k!=='validationToken')||url.searchParams.getAll('validationToken').length!==1)throw invalid();
            let validation;try{validation=graphValidationResponse(url.searchParams.get('validationToken'));}catch{throw invalid();}
            check(signal);if(!res.destroyed&&!res.writableEnded){res.writeHead(validation.status,{'content-type':validation.contentType,'cache-control':'no-store','x-content-type-options':'nosniff','content-length':Buffer.byteLength(validation.body)});res.end(validation.body);}return;
          }
          if(url.search||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))throw invalid();
          await admitted(signal);const payload=await body(req,signal,maxGraphBodyBytes);check(signal);committing=true;
          const result=await graphReceive(payload,{signal});check(signal);
          shape(result,['status','accepted','replayed']);if(result.status!==202||!Number.isInteger(result.accepted)||result.accepted<1||result.accepted>100||!Number.isInteger(result.replayed)||result.replayed<0||result.replayed>result.accepted)throw new Error('GRAPH_INBOX_UNVERIFIED');
          send(res,202,{status:'ACCEPTED',accepted:result.accepted,replayed:result.replayed},traceId);return;
        }
        if(req.method==='GET'&&(url.pathname==='/api/v1/processing/reviews'||url.pathname.startsWith('/api/v1/processing/reviews/'))){
          if(!reviewList)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
          if(req.headers['transfer-encoding']||req.headers['content-length']&&req.headers['content-length']!=='0')throw invalid();
          const detail=url.pathname!=='/api/v1/processing/reviews',eventId=detail?url.pathname.slice('/api/v1/processing/reviews/'.length):null;
          if(detail){uuid(eventId);if(url.search)throw invalid();}
          const names=[...url.searchParams.keys()];if(!detail&&(names.some(k=>!['status','limit','cursor'].includes(k))||new Set(names).size!==names.length))throw invalid();
          const limitRaw=url.searchParams.get('limit'),limit=limitRaw===null?25:Number(limitRaw),status=url.searchParams.get('status')??'PENDING',cursor=url.searchParams.get('cursor');
          if(!detail&&(!['PENDING','DECIDED','ALL'].includes(status)||limitRaw!==null&&!/^[1-9][0-9]{0,2}$/.test(limitRaw)||!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&(cursor.length>1600||!cursor)))throw invalid();
          await admitted(signal);const session=normalizeSession(await bound.authenticate(req.headers,{method:req.method,url:req.url}));check(signal);
          if(!['OIDC','SERVER_SESSION'].includes(session.authContext.method))throw appError('authentication required',{status:401,code:'AUTH_REQUIRED'});
          uuid(session.tenantId);uuid(session.actorId);requireCapability(session,'inbound:review');await bound.checkTenant(session);check(signal);
          const context=Object.freeze({tenantId:session.tenantId,actorId:session.actorId,eventId,kind:'REVIEW_READ',signal});
          if(await authorizeRequest({...context,phase:'ADMIT'})!==true)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});await admitted(signal);
          const input=detail?{tenantId:session.tenantId,actorId:session.actorId,eventId}:{tenantId:session.tenantId,actorId:session.actorId,status,limit,cursor};
          const output=await (detail?reviewGet(input,{signal}):reviewList(input,{signal}));check(signal);send(res,200,output,traceId);return;
        }
        if(req.method==='POST'&&url.pathname==='/api/v1/processing/review-decisions'){
          if(!reviewDecide)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
          if(url.search||req.headers['content-type']!=='application/json')throw invalid();
          await admitted(signal);
          const session=normalizeSession(await bound.authenticate(req.headers,{method:req.method,url:req.url}));check(signal);
          if(!['OIDC','SERVER_SESSION'].includes(session.authContext.method))throw appError('authentication required',{status:401,code:'AUTH_REQUIRED'});
          uuid(session.tenantId);uuid(session.actorId);requireCapability(session,'inbound:review');await bound.checkTenant(session);check(signal);
          const value=await body(req,signal,maxBodyBytes);shape(value,['eventId','decision','matterId','decisionKey','expectedResultJobId','expectedResultHash']);
          uuid(value.eventId);uuid(value.expectedResultJobId);hash(value.expectedResultHash);
          if(typeof value.decisionKey!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/.test(value.decisionKey)||req.headers['idempotency-key']!==value.decisionKey
            ||!['APPROVE','REJECT'].includes(value.decision)||value.decision==='APPROVE'&&!UUID.test(value.matterId)||value.decision==='REJECT'&&value.matterId!==null)throw invalid();
          const context=Object.freeze({...value,tenantId:session.tenantId,actorId:session.actorId,kind:'REVIEW_DECISION',signal});
          if(await authorizeRequest({...context,phase:'ADMIT'})!==true)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});await admitted(signal);
          committing=true;const result=await reviewDecide({...value,tenantId:session.tenantId,actorId:session.actorId},{signal});
          if(!signal.aborted){const {tenantId,...output}=result;send(res,200,output,traceId);}return;
        }
        await admitted(signal);
        const kind=!allowDirectCommands?null:req.method==='POST'&&req.url==='/api/v1/processing/inbound'?'PROCESS_INBOUND':req.method==='POST'&&req.url==='/api/v1/processing/policy-evaluations'?'POLICY_EVALUATION':null;
        if(!kind)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
        if(req.headers['content-type']!=='application/json')throw invalid();
        const session=normalizeSession(await bound.authenticate(req.headers,{method:req.method,url:req.url}));check(signal);
        if(!['OIDC','SERVER_SESSION'].includes(session.authContext.method))throw appError('authentication required',{status:401,code:'AUTH_REQUIRED'});
        uuid(session.tenantId);uuid(session.actorId);requireCapability(session,kind==='PROCESS_INBOUND'?'inbound:create':'policy:evaluate');await bound.checkTenant(session);check(signal);
        const value=await body(req,signal,maxBodyBytes),keys=kind==='PROCESS_INBOUND'?['commandId','jobId','eventId','payloadId','payloadHash','sourceSystem','externalEventId']:['commandId','jobId','matterId','policyVersionId','policyVersionHash'];shape(value,keys);
        for(const key of keys.filter(k=>k.endsWith('Id')&&k!=='externalEventId'))uuid(value[key]);
        hash(value[kind==='PROCESS_INBOUND'?'payloadHash':'policyVersionHash']);
        if(req.headers['idempotency-key']!==value.commandId)throw invalid();
        if(kind==='PROCESS_INBOUND'&&(!['MANUAL','MANUAL_UPLOAD','MICROSOFT_GRAPH'].includes(value.sourceSystem)||typeof value.externalEventId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/.test(value.externalEventId)))throw invalid();
        const context=Object.freeze({tenantId:session.tenantId,actorId:session.actorId,kind,commandId:value.commandId,jobId:value.jobId,objectId:value.eventId??value.matterId,artifactId:value.payloadId??value.policyVersionId,artifactHash:value.payloadHash??value.policyVersionHash,signal});
        if(await authorizeRequest({...context,phase:'ADMIT'})!==true)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});await admitted(signal);
        // Unknown acquisition remains latched in the shared drain adapter.
        try{lease=await drain.acquire({kind:'INGRESS',operationId:`http:${crypto.randomUUID()}`});}catch{uncertain=true;throw notReady();}check(signal);
        await audit({...context,phase:'ATTEMPT'});check(signal);
        if(await authorizeRequest({...context,phase:'DISPATCH'})!==true)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});await admitted(signal);
        committing=true;
        const result=await bound[kind==='PROCESS_INBOUND'?'registerInbound':'requestPolicyEvaluation']({...value,tenantId:session.tenantId,actorId:session.actorId,traceId:`http-command:${value.commandId}`,signal});
        const output=receipt(result,{tenantId:session.tenantId,commandId:value.commandId,jobId:value.jobId,kind,objectId:context.objectId});accepted=true;
        await audit({...context,phase:'ACCEPTED'});if(!signal.aborted)send(res,202,output,traceId);
      }catch(error){
        if(!res.writableEnded){
          if(['REVIEW_READ_INPUT_INVALID','MANAGED_REVIEW_INPUT_INVALID','REVIEW_DECISION_INPUT_INVALID'].includes(error?.message))send(res,400,{code:'INVALID_REQUEST'},traceId);
          else if(error?.message==='REVIEW_DECISION_CONFLICT')send(res,409,{code:'REVIEW_CONFLICT'},traceId);
          else if(['REVIEW_READ_FORBIDDEN','REVIEW_DECISION_FORBIDDEN','MANAGED_REVIEW_FORBIDDEN'].includes(error?.message))send(res,404,{code:'NOT_FOUND'},traceId);
          else if(error?.message==='GRAPH_INBOX_INPUT_INVALID')send(res,400,{code:'INVALID_REQUEST'},traceId);
          else if(committing&&(accepted||!['DOMAIN_COMMAND_CONFLICT','DOMAIN_COMMAND_FORBIDDEN'].includes(error?.message)))send(res,503,{status:'OUTCOME_UNVERIFIED'},traceId);
          else if(error?.message==='DOMAIN_COMMAND_CONFLICT')send(res,409,{code:'COMMAND_CONFLICT'},traceId);
          else if(error?.message==='DOMAIN_COMMAND_FORBIDDEN')send(res,404,{code:'NOT_FOUND'},traceId);
          else{const safe=publicError(error);send(res,safe.status,safe.status>=500?{status:'NOT_READY'}:{code:safe.code},traceId);}
        }
      }finally{
        // Release only after the actual callback settles, even after timeout or
        // disconnect. A lost acknowledgement blocks future admission/restart.
        if(lease)try{await drain.release(lease);}catch{uncertain=true;}
        req.resume();
      }
    });pending.add(task);
    task.finally(()=>{clearTimeout(timer);res.off('close',abort);controllers.delete(controller);pending.delete(task);}).catch(()=>{});
  });
  server.requestTimeout=requestTimeoutMs;server.headersTimeout=Math.min(requestTimeoutMs,10000);server.maxHeadersCount=64;
  return Object.freeze({server,status:()=>Object.freeze({inFlight:pending.size,acceptingNew:available(),uncertain}),
    resume(){if(pending.size||uncertain)throw new Error('PROCESSING_HTTP_UNDRAINED');closed=false;},
    async stop({timeoutMs=5000}={}){if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw new Error('PROCESSING_HTTP_CONFIGURATION_INVALID');closed=true;for(const c of controllers)c.abort();
      let timer;const settled=await Promise.race([Promise.allSettled([...pending]).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);clearTimeout(timer);return Object.freeze({drained:settled&&!pending.size&&!uncertain,inFlight:pending.size});}
  });
}
