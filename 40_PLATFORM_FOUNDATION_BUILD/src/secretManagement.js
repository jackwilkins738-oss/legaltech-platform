import crypto from 'node:crypto';
import {appError} from './errors.js';

const SECRET_SCHEMES=new Set(['secret:','keyvault:','secretsmanager:','secretmanager:']);
const CONNECTOR_KINDS=new Set(['MICROSOFT_GRAPH','PROCLAIM']);
const SECRET_KEY=/^(?:password|passwd|clientsecret|client_secret|access[_-]?token|refresh[_-]?token|authorization|api[_-]?key|private[_-]?key|secret|credential)$/i;
const OBVIOUS_SECRET=/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/;
const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return undefined;return d.value;};
const id=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const invalid=()=>appError('credential unavailable',{status:503,code:'CREDENTIAL_UNAVAILABLE'});

export function parseManagedSecretRef(value){
  if(!id(value,512)||value.includes('%'))throw new Error('MANAGED_SECRET_REF_INVALID');
  let url;try{url=new URL(value);}catch{throw new Error('MANAGED_SECRET_REF_INVALID');}
  if(!SECRET_SCHEMES.has(url.protocol)||url.username||url.password||url.search||url.hash||!url.hostname)throw new Error('MANAGED_SECRET_REF_INVALID');
  const pieces=[url.hostname,...url.pathname.split('/').filter(Boolean)];
  if(pieces.length<2||pieces.length>8||pieces.some(x=>!/^[A-Za-z0-9._-]{1,128}$/.test(x)))throw new Error('MANAGED_SECRET_REF_INVALID');
  return Object.freeze({scheme:url.protocol.slice(0,-1),authority:url.hostname,path:Object.freeze(pieces.slice(1)),canonical:`${url.protocol}//${pieces.join('/')}`});
}

export function assertNoSecretMaterial(value,{maxNodes=5000,maxDepth=10}={}){
  let nodes=0;const seen=new Set();
  function walk(item,depth){
    if(++nodes>maxNodes||depth>maxDepth)throw new Error('SECRET_MATERIAL_REJECTED');
    if(item===null||typeof item==='boolean'||typeof item==='number')return true;
    if(typeof item==='string'){if(OBVIOUS_SECRET.test(item))throw new Error('SECRET_MATERIAL_REJECTED');return true;}
    if(typeof item!=='object'||seen.has(item))throw new Error('SECRET_MATERIAL_REJECTED');
    if(Buffer.isBuffer(item)||ArrayBuffer.isView(item)||item instanceof ArrayBuffer)throw new Error('SECRET_MATERIAL_REJECTED');
    seen.add(item);
    const descriptors=Object.getOwnPropertyDescriptors(item);
    for(const key of Reflect.ownKeys(descriptors)){
      if(typeof key!=='string')throw new Error('SECRET_MATERIAL_REJECTED');
      const d=descriptors[key];if(!Object.hasOwn(d,'value'))throw new Error('SECRET_MATERIAL_REJECTED');
      const safeReference=/^(?:credentialRef|credentialMode|secretRef|secretMode)$/i.test(key);
      if(SECRET_KEY.test(key)&&!safeReference)throw new Error('SECRET_MATERIAL_REJECTED');
      walk(d.value,depth+1);
    }
    seen.delete(item);return true;
  }
  return walk(value,0);
}

function credentialResult(value,clock){
  if(!plain(value))throw invalid();
  const bytes=own(value,'value'),generation=own(value,'generation'),expiresAt=own(value,'expiresAt'),state=own(value,'state'),tenantId=own(value,'tenantId'),kind=own(value,'kind');
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>64*1024||!Number.isSafeInteger(generation)||generation<1||state!=='ACTIVE'||!id(tenantId,200)||!CONNECTOR_KINDS.has(kind)||!id(expiresAt,64))throw invalid();
  const expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=clock())throw invalid();
  return {bytes,generation,expiry,tenantId,kind};
}
function bindingKey(tenantId,kind,canonical){return JSON.stringify([tenantId,kind,canonical]);}
function publicDescriptor({tenantId,kind,ref,generation,expiresAt,purpose}){
  const fingerprint=crypto.createHash('sha256').update(ref).digest('hex').slice(0,20);
  return Object.freeze({tenantId,kind,credentialRefFingerprint:fingerprint,generation,expiresAt,purpose});
}
function leaksCredential(value,secret,depth=0,seen=new Set()){
  if(depth>6||value===null||value===undefined)return false;
  if(typeof value==='string')return value.length>0&&Buffer.from(value).equals(secret);
  if(Buffer.isBuffer(value))return value.length===secret.length&&crypto.timingSafeEqual(value,secret);
  if(typeof value!=='object'||seen.has(value))return false;seen.add(value);
  for(const d of Object.values(Object.getOwnPropertyDescriptors(value)))if(Object.hasOwn(d,'value')&&leaksCredential(d.value,secret,depth+1,seen))return true;
  return false;
}


export function redactPublicIntegrationData(value,{maxNodes=5000,maxDepth=10}={}){
  let nodes=0;const seen=new Set();
  function walk(item,depth){
    if(++nodes>maxNodes||depth>maxDepth)throw new Error('PUBLIC_INTEGRATION_PAYLOAD_INVALID');
    if(item===null||typeof item==='boolean'||typeof item==='number')return item;
    if(typeof item==='string'){
      if(OBVIOUS_SECRET.test(item))return '[REDACTED]';
      try{parseManagedSecretRef(item);return '[MANAGED_SECRET_REF]';}catch{return item;}
    }
    if(typeof item!=='object'||seen.has(item)||Buffer.isBuffer(item)||ArrayBuffer.isView(item)||item instanceof ArrayBuffer)return '[REDACTED]';
    seen.add(item);let out;
    if(Array.isArray(item)){out=item.slice(0,1000).map(v=>walk(v,depth+1));}
    else{
      out={};const descriptors=Object.getOwnPropertyDescriptors(item);
      for(const [key,d] of Object.entries(descriptors)){
        if(!Object.hasOwn(d,'value'))continue;
        if(SECRET_KEY.test(key)||/^(?:credentialRef|secretRef)$/i.test(key)){out[key]='[REDACTED]';continue;}
        out[key]=walk(d.value,depth+1);
      }
    }
    seen.delete(item);return out;
  }
  return walk(value,0);
}

export class InMemoryCredentialGenerationStore {
  #values=new Map();
  async get(key){return this.#values.get(key)??0;}
  async observe(key,generation){const current=this.#values.get(key)??0,next=Math.max(current,generation);this.#values.set(key,next);return next;}
}

export class ConnectorCredentialBroker {
  #provider;#clock;#generationStore;#interlock;#rotationAuthority;
  constructor({provider,generationStore=new InMemoryCredentialGenerationStore(),securityInterlock=null,rotationAuthority=null,clock=()=>Date.now()}={}){
    if(!provider||typeof provider.resolve!=='function'||!generationStore||typeof generationStore.get!=='function'||typeof generationStore.observe!=='function'||typeof clock!=='function')throw new Error('CREDENTIAL_BROKER_CONFIGURATION_INVALID');
    if(securityInterlock!==null&&typeof securityInterlock?.assertAllowed!=='function')throw new Error('CREDENTIAL_BROKER_CONFIGURATION_INVALID');
    if(rotationAuthority!==null&&typeof rotationAuthority?.assertUsable!=='function')throw new Error('CREDENTIAL_BROKER_CONFIGURATION_INVALID');this.#provider=provider;this.#generationStore=generationStore;this.#interlock=securityInterlock;this.#rotationAuthority=rotationAuthority;this.#clock=clock;
  }
  async withCredential({tenantId,kind,credentialRef,purpose,capabilities=[]}={},consumer){
    if(!id(tenantId,200)||!CONNECTOR_KINDS.has(kind)||!id(purpose,128)||!Array.isArray(capabilities)||capabilities.length<1||capabilities.length>64||capabilities.some(x=>!id(x,128))||!capabilities.includes(purpose)||typeof consumer!=='function')throw invalid();
    let parsed;try{parsed=parseManagedSecretRef(credentialRef);}catch{throw invalid();}
    await this.#interlock?.assertAllowed({tenantId,operation:'CONNECTOR_USE'});
    let resolved;
    try{resolved=await this.#provider.resolve(Object.freeze({tenantId,kind,credentialRef:parsed.canonical,purpose}));}catch{throw invalid();}
    const checked=credentialResult(resolved,this.#clock);
    if(checked.tenantId!==tenantId||checked.kind!==kind){try{checked.bytes.fill(0);}catch{}throw invalid();}
    const key=bindingKey(tenantId,kind,parsed.canonical);let highest,observed;
    try{highest=await this.#generationStore.get(key);if(!Number.isSafeInteger(highest)||highest<0)throw new Error();if(checked.generation<highest)throw new Error();observed=await this.#generationStore.observe(key,checked.generation);if(!Number.isSafeInteger(observed)||observed<checked.generation||observed>checked.generation)throw new Error();}catch{checked.bytes.fill(0);throw invalid();}
    try{this.#rotationAuthority?.assertUsable({tenantId,purpose,secretRef:parsed.canonical,generation:checked.generation});}catch{checked.bytes.fill(0);throw invalid();}
    try{await this.#interlock?.assertAllowed({tenantId,operation:'CONNECTOR_USE'});}catch(error){checked.bytes.fill(0);throw error;}
    const lease=Buffer.from(checked.bytes);checked.bytes.fill(0);
    const descriptor=publicDescriptor({tenantId,kind,ref:parsed.canonical,generation:checked.generation,expiresAt:new Date(checked.expiry).toISOString(),purpose});
    try{
      const result=await consumer(lease,descriptor);
      if(leaksCredential(result,lease))throw appError('credential egress blocked',{status:500,code:'CREDENTIAL_EGRESS_BLOCKED'});
      return result;
    } finally { lease.fill(0); }
  }
}
