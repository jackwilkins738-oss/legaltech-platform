import crypto from 'node:crypto';
import {normalizeClassificationResult} from './aiGateway.js';
const canonical=value=>Array.isArray(value)?value.map(canonical)
  :value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export const sourceFingerprint=event=>digest([
  event.id,event.tenantId,event.traceId,event.sourceSystem,event.externalEventId,
  event.subject,event.body,event.attachments,event.ingestFingerprint,
]);
export const processingFingerprint=event=>digest([
  sourceFingerprint(event),normalizeClassificationResult(event.classification),event.match,
]);
export function assertProcessingEvidence(event) {
  // Historical recognized synthetic results remain usable under the old human gates.
  const classification=normalizeClassificationResult(event.classification);
  const processing=event.processing;
  if(processing&&(Object.hasOwn(processing,'evidenceVersion')||Object.hasOwn(processing,'evidenceFingerprint'))&&
      (processing.evidenceVersion!=='v51'||processing.evidenceFingerprint!==processingFingerprint(event)))throw new Error('processing evidence changed');
  return classification;
}
