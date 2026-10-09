import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
export const JOB_KINDS=Object.freeze(['PROCESS_INBOUND','POLICY_EVALUATION','PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY']);
const keys=['tenantId','jobId','kind','objectId','traceHash','keyHash','maxAttempts','leaseMs','maxRunMs','delayMs','retryDelayMs'];
export const intentHash=value=>crypto.createHash('sha256').update(canonicalAuditPayload(value)).digest('hex');
function invalid(){throw new Error('QUEUE_INPUT_INVALID');}
export function validateJobIntent(value) {
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||Reflect.ownKeys(value).some(k=>!keys.includes(k)))invalid();
  const copy={...value};
  for(const k of ['tenantId','jobId','objectId'])if(typeof copy[k]!=='string'||!UUID.test(copy[k]))invalid();
  if(!JOB_KINDS.includes(copy.kind)||!HEX.test(copy.traceHash)||!HEX.test(copy.keyHash)||typeof copy.traceHash!=='string'||typeof copy.keyHash!=='string')invalid();
  for(const [key,min,max] of [['maxAttempts',1,10],['leaseMs',5000,300000],['maxRunMs',copy.leaseMs,3600000],['delayMs',0,86400000],['retryDelayMs',1000,3600000]])if(!Number.isInteger(copy[key])||copy[key]<min||copy[key]>max)invalid();
  return Object.freeze(copy);
}
export function prepareJobIntent(input) {
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(k=>!['tenantId','jobId','kind','objectId','traceId','idempotencyKey','maxAttempts','leaseMs','maxRunMs','delayMs','retryDelayMs'].includes(k)))invalid();
  const id=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;
  if(typeof input.traceId!=='string'||!id.test(input.traceId)||typeof input.idempotencyKey!=='string'||!id.test(input.idempotencyKey))invalid();
  const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
  return validateJobIntent({tenantId:typeof input.tenantId==='string'?input.tenantId.toLowerCase():null,jobId:typeof input.jobId==='string'?input.jobId.toLowerCase():null,kind:input.kind,
    objectId:typeof input.objectId==='string'?input.objectId.toLowerCase():null,traceHash:digest(input.traceId),keyHash:digest(input.idempotencyKey),maxAttempts:input.maxAttempts??5,
    leaseMs:input.leaseMs??60000,maxRunMs:input.maxRunMs??900000,delayMs:input.delayMs??0,retryDelayMs:input.retryDelayMs??1000});
}
