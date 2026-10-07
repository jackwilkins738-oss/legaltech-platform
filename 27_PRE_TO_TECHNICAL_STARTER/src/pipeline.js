import {eventEnvelope} from './domain.js';
import {matchMatter} from './matcher.js';

export async function processInbound({tenantId,email,matters,proclaim,idempotency,audit,confirmedMatterId=null}) {
  const env=eventEnvelope({tenantId,eventType:'graph.message.received.v1',sourceSystem:'MICROSOFT_GRAPH',sourceId:email.email_id,payload:{subject:email.subject}});
  const claim=idempotency.claim(`${tenantId}:message:${email.email_id}`,env.event_id);
  if(claim.duplicate) return {status:'DUPLICATE',traceId:env.trace_id};

  const match=matchMatter(email,matters);
  audit.record({tenantId,action:'MATTER_MATCH_EVALUATED',objectType:'communication',objectId:email.email_id,traceId:env.trace_id,reason:match.reason});

  if(match.decision==='BLOCK' || match.decision==='NO_MATCH') return {status:'EXCEPTION',match,traceId:env.trace_id};
  let matterId=match.decision==='AUTO' ? match.candidates[0]?.matter_id : confirmedMatterId;
  if(!matterId) return {status:'REVIEW_REQUIRED',match,traceId:env.trace_id};

  const writeKey=`${tenantId}:${email.email_id}:CREATE_HISTORY:${matterId}`;
  const write=await proclaim.createHistory({externalMatterId:matterId,idempotencyKey:writeKey,payload:{sourceEmailId:email.email_id,subject:email.subject}});
  const verified=await proclaim.verifyHistory({externalMatterId:matterId,externalWriteId:write.externalWriteId});
  if(!verified) throw new Error('writeback verification failed');
  audit.record({tenantId,action:'PROCLAIM_WRITEBACK_VERIFIED',objectType:'matter',objectId:matterId,traceId:env.trace_id});
  return {status:'WRITTEN',matterId,externalWriteId:write.externalWriteId,match,traceId:env.trace_id};
}
