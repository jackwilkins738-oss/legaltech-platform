import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const AAD=Buffer.from('legaltech-work-cursor-v1','utf8');
const TOKEN=/^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,2048}\.[A-Za-z0-9_-]{16,64}$/;
const safeText=(v,code,max=256)=>{if(typeof v!=='string'||!v||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error(code);return v;};
const hash=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');

function normalizeFilters({owner=null,states=null,types=null,matterId=null}={}){
  let cleanOwner=null;
  if(owner!==null){if(!owner||typeof owner!=='object'||Array.isArray(owner))throw new Error('WORK_CURSOR_CONTEXT_INVALID');cleanOwner={kind:safeText(owner.kind,'WORK_CURSOR_CONTEXT_INVALID',32),id:safeText(owner.id,'WORK_CURSOR_CONTEXT_INVALID')};}
  const cleanList=(value,code)=>{if(value==null)return null;if(!Array.isArray(value)||value.length>16)throw new Error(code);return [...new Set(value.map(v=>safeText(v,code,64)))].sort();};
  return Object.freeze({owner:cleanOwner,states:cleanList(states,'WORK_CURSOR_CONTEXT_INVALID'),types:cleanList(types,'WORK_CURSOR_CONTEXT_INVALID'),matterId:matterId==null?null:safeText(matterId,'WORK_CURSOR_CONTEXT_INVALID')});
}

export class WorkCursorCodec {
  #key;#ttlMs;#now;
  constructor({key=crypto.randomBytes(32),ttlMs=15*60*1000,now=()=>Date.now()}={}){
    const b=Buffer.from(key??[]);if(b.length!==32)throw new Error('WORK_CURSOR_KEY_INVALID');
    if(!Number.isInteger(ttlMs)||ttlMs<60_000||ttlMs>60*60*1000||typeof now!=='function')throw new Error('WORK_CURSOR_CONFIGURATION_INVALID');
    this.#key=Buffer.from(b);this.#ttlMs=ttlMs;this.#now=now;
  }
  context(filters){return hash(normalizeFilters(filters));}
  encode({tenantId,offset,filters}={}){
    safeText(tenantId,'WORK_CURSOR_TENANT_REQUIRED');if(!Number.isInteger(offset)||offset<0||offset>1_000_000_000)throw new Error('WORK_CURSOR_OFFSET_INVALID');
    const payload=Buffer.from(JSON.stringify({v:1,t:tenantId,o:offset,f:this.context(filters),e:this.#now()+this.#ttlMs}),'utf8');
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(AAD);const body=Buffer.concat([cipher.update(payload),cipher.final()]),tag=cipher.getAuthTag();
    return `${iv.toString('base64url')}.${body.toString('base64url')}.${tag.toString('base64url')}`;
  }
  decode(token,{tenantId,filters}={}){
    safeText(tenantId,'WORK_CURSOR_TENANT_REQUIRED');if(typeof token!=='string'||token.length>2200||!TOKEN.test(token))throw new Error('WORK_CURSOR_INVALID');
    try{
      const [ivRaw,bodyRaw,tagRaw]=token.split('.'),iv=Buffer.from(ivRaw,'base64url'),body=Buffer.from(bodyRaw,'base64url'),tag=Buffer.from(tagRaw,'base64url');if(iv.length!==12||tag.length!==16||body.length<16||iv.toString('base64url')!==ivRaw||body.toString('base64url')!==bodyRaw||tag.toString('base64url')!==tagRaw)throw new Error('bad');
      const decipher=crypto.createDecipheriv('aes-256-gcm',this.#key,iv);decipher.setAAD(AAD);decipher.setAuthTag(tag);const data=JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8'));
      if(!data||data.v!==1||data.t!==tenantId||data.f!==this.context(filters)||!Number.isInteger(data.o)||data.o<0||data.o>1_000_000_000||!Number.isFinite(data.e))throw new Error('context');
      if(data.e<=this.#now())throw new Error('expired');
      return data.o;
    }catch(e){if(e?.message==='expired')throw new Error('WORK_CURSOR_EXPIRED');throw new Error('WORK_CURSOR_INVALID');}
  }
}
