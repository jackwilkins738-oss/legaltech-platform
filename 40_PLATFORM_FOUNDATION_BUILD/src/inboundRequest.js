import crypto from 'node:crypto';
import {appError} from './errors.js';

const invalid = () => appError('invalid inbound request', {code:'INVALID_REQUEST'});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceSystems = ['MANUAL','MANUAL_UPLOAD','MICROSOFT_GRAPH'];
function text(value, fallback, max, {nonempty=false, noControls=false}={}) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length>max || (nonempty&&!value.trim()) || (noControls&&/[\x00-\x1f\x7f]/.test(value))) throw invalid();
  return value;
}
function attachmentMetadata(attachment) {
  if (!isRecord(attachment)) throw invalid();
  const filename=text(attachment.filename,null,255,{nonempty:true,noControls:true});
  if (!filename || /[\\/]/.test(filename) || ['.','..'].includes(filename)) throw invalid();
  return {filename,contentType:text(attachment.contentType,'application/octet-stream',255,{nonempty:true,noControls:true})};
}

export function normalizeInboundInput(input) {
  if (!isRecord(input)) throw invalid();
  const sourceSystem=input.sourceSystem??'MANUAL';
  if (!sourceSystems.includes(sourceSystem)) throw appError('unsupported source system',{code:'INVALID_SOURCE_SYSTEM'});
  const attachments=input.attachments??[];
  if (!Array.isArray(attachments)||attachments.length>100) throw invalid();
  return {
    sourceSystem,
    externalEventId:text(input.externalEventId,null,512,{nonempty:true,noControls:true}),
    subject:text(input.subject,'',4096),body:text(input.body,'',1024*1024),
    attachments:attachments.map(attachment=>{
      const metadata=attachmentMetadata(attachment);
      const bytes=attachment.bytes??Buffer.alloc(0);
      if (!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array)) throw invalid();
      return {...metadata,bytes:Buffer.from(bytes)};
    }),
  };
}

export function decodeInboundBody(body) {
  if (!isRecord(body)) throw invalid();
  const attachments=body.attachments??[];
  if (!Array.isArray(attachments)||attachments.length>100) throw invalid();
  return normalizeInboundInput({...body,attachments:attachments.map(attachment=>{
    const metadata=attachmentMetadata(attachment);
    const hasBase64=Object.hasOwn(attachment,'base64'),hasText=Object.hasOwn(attachment,'text');
    if (hasBase64&&hasText) throw invalid();
    let bytes=Buffer.alloc(0);
    if (hasBase64) {
      const value=attachment.base64;
      // Standard canonical padded base64 only: Buffer.from silently ignores garbage.
      if (typeof value!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw invalid();
      bytes=Buffer.from(value,'base64');
      if (bytes.toString('base64')!==value) throw invalid();
    } else if (hasText) {
      if (typeof attachment.text!=='string') throw invalid();
      bytes=Buffer.from(attachment.text,'utf8');
    }
    return {...metadata,bytes};
  })});
}

export function inboundFingerprint(input) {
  const canonical=['v41',input.sourceSystem,input.externalEventId,input.subject,input.body,
    input.attachments.map(attachment=>[attachment.filename,attachment.contentType,attachment.bytes.length,
      crypto.createHash('sha256').update(attachment.bytes).digest('hex')])];
  return `v41:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}
export const ingestScope=(tenantId,key)=>JSON.stringify(['inbound-ingest',tenantId,key]);
