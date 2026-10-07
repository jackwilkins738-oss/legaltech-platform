import crypto from 'node:crypto';
import {appError} from './errors.js';
const invalid=()=>appError('invalid review request',{code:'INVALID_REQUEST'});
const identifier=value=>typeof value==='string'&&value.trim()&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value);
export function normalizeReviewRequest({resolution,matterId=null,notes=null,actorId,idempotencyKey}) {
  if (!identifier(idempotencyKey)) throw appError('idempotency key required',{code:'IDEMPOTENCY_REQUIRED'});
  if (!identifier(actorId)) throw appError('actor required',{code:'ACTOR_REQUIRED'});
  if (!['APPROVE','REJECT'].includes(resolution)) throw appError('unsupported resolution',{code:'INVALID_RESOLUTION'});
  if (matterId!==null&&!identifier(matterId)) throw invalid();
  if (notes!==null&&(typeof notes!=='string'||notes.length>4096||notes.includes('\u0000'))) throw invalid();
  return {resolution,matterId,notes:notes===''?null:notes,actorId,idempotencyKey};
}
export const reviewScope=(tenantId,key)=>JSON.stringify(['exception-resolve',tenantId,key]);
export const reviewFingerprint=request=>crypto.createHash('sha256').update(JSON.stringify([request.resolution,request.matterId,request.notes,request.actorId])).digest('hex');
