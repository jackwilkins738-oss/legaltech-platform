import crypto from 'node:crypto';
import {appError} from './errors.js';
import {parseManagedSecretRef} from './secretManagement.js';

const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const data=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d)return undefined;if(!Object.hasOwn(d,'value'))throw appError('invalid connector payload',{code:'INVALID_REQUEST'});return d.value;};
const text=(value,max=1024)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
export function verifyGraphClientState(provided,expected){
  if(!text(provided,512)||!text(expected,512))return false;
  const a=Buffer.from(provided),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function validateGraphNotificationBatch(input,{expectedClientState,maxItems=100,maxBytes=256*1024}={}){
  if(!plain(input)||!text(expectedClientState,512)||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>1000||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024)throw appError('invalid connector payload',{code:'INVALID_REQUEST'});
  const rows=data(input,'value');if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length<1||rows.length>maxItems)throw appError('invalid connector payload',{code:'INVALID_REQUEST'});
  let total=0;const normalized=[];
  for(let i=0;i<rows.length;i++){
    const row=data(rows,String(i));if(!plain(row))throw appError('invalid connector payload',{code:'INVALID_REQUEST'});
    const subscriptionId=data(row,'subscriptionId'),resource=data(row,'resource'),changeType=data(row,'changeType'),clientState=data(row,'clientState');
    if(!text(subscriptionId,200)||!text(resource,2048)||!text(changeType,64)||!verifyGraphClientState(clientState,expectedClientState))throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
    total+=Buffer.byteLength(subscriptionId)+Buffer.byteLength(resource)+Buffer.byteLength(changeType)+Buffer.byteLength(clientState);
    if(total>maxBytes)throw appError('connector payload too large',{status:413,code:'BODY_TOO_LARGE'});
    normalized.push(Object.freeze({subscriptionId,resource,changeType}));
  }
  return Object.freeze(normalized);
}

export function assertLiveConnectorConfig(config,{kind}={}){
  if(!plain(config)||!['MICROSOFT_GRAPH','PROCLAIM'].includes(kind))throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');
  const mode=data(config,'mode'),credentialRef=data(config,'credentialRef'),capabilities=data(config,'capabilities');
  if(mode!=='LIVE'||!text(credentialRef,512))throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');
  try{parseManagedSecretRef(credentialRef);}catch{throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');}
  if(!Array.isArray(capabilities)||capabilities.length<1||capabilities.length>64||capabilities.some(x=>!text(x,128)))throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');
  if(kind==='MICROSOFT_GRAPH'&&capabilities.includes('MAILBOX_ALL'))throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');
  if(kind==='PROCLAIM'&&capabilities.includes('WRITE')&&!capabilities.includes('READ_BACK'))throw new Error('LIVE_CONNECTOR_CONFIGURATION_INVALID');
  return true;
}
