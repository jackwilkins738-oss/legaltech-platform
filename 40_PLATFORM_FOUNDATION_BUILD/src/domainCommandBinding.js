import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const columns={tenantId:'tenant_id',commandId:'command_id',actorId:'actor_id',jobId:'job_id',kind:'kind',objectId:'object_id',inboundEventId:'inbound_event_id',matterId:'matter_id',payloadId:'payload_id',payloadHash:'payload_hash',sourceHash:'source_hash',policyVersionId:'policy_version_id',policyVersionHash:'policy_version_hash',traceHash:'trace_hash'};
export const commandRequestHash=(binding,sourceSystem)=>crypto.createHash('sha256').update(canonicalAuditPayload({...binding,sourceSystem})).digest('hex');
export function decodeDomainCommand(row,sourceSystem) {
  const fail=()=>{throw new Error('WORKER_DOMAIN_BINDING_INVALID');};
  if(!row)fail();const b=Object.fromEntries(Object.entries(columns).map(([k,col])=>[k,row[col]]));
  for(const k of ['tenantId','commandId','actorId','jobId','objectId'])if(typeof b[k]!=='string'||!UUID.test(b[k]))fail();
  if(typeof b.traceHash!=='string'||!HEX.test(b.traceHash))fail();
  if(b.kind==='PROCESS_INBOUND'){
    if(!['MANUAL','MANUAL_UPLOAD','MICROSOFT_GRAPH'].includes(sourceSystem)||!UUID.test(b.inboundEventId??'')||b.objectId!==b.inboundEventId||!UUID.test(b.payloadId??'')
      ||!HEX.test(b.payloadHash??'')||!HEX.test(b.sourceHash??'')||b.matterId!==null||b.policyVersionId!==null||b.policyVersionHash!==null)fail();
  }else if(b.kind==='POLICY_EVALUATION'){
    if(sourceSystem!==null||!UUID.test(b.matterId??'')||b.objectId!==b.matterId||!UUID.test(b.policyVersionId??'')||!HEX.test(b.policyVersionHash??'')
      ||b.inboundEventId!==null||b.payloadId!==null||b.payloadHash!==null||b.sourceHash!==null)fail();
  }else fail();
  if(row.request_hash!==commandRequestHash(b,sourceSystem)||typeof row.intent_hash!=='string'||!HEX.test(row.intent_hash))fail();
  return Object.freeze({...b,sourceSystem,requestHash:row.request_hash,intentHash:row.intent_hash});
}
