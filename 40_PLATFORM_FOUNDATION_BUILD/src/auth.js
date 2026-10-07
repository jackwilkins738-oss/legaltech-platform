import crypto from 'node:crypto';
import {appError} from './errors.js';

const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const invalid=(code='AUTH_REQUIRED')=>appError(code==='OIDC_VERIFICATION_REQUIRED'?'verified oidc claims required':'authentication required',{status:code==='AUTH_CONFIGURATION_INVALID'?400:401,code});
function own(value,key,code) {
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor,'value')) throw invalid(code);
  return descriptor.value;
}
function identifier(value,code) {
  if(typeof value!=='string'||value.length<1||value.length>200||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value)) throw invalid(code);
  return value;
}
function labels(value,code) {
  if(value===undefined) return Object.freeze([]);
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>128) throw invalid(code);
  const result=[];
  for(let i=0;i<value.length;i++) {
    const item=own(value,String(i),code);
    if(typeof item!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item)) throw invalid(code);
    result.push(item);
  }
  return Object.freeze([...new Set(result)]);
}
// This validates trusted provider output; it does not authenticate bearer tokens or verify JWTs.
export function normalizeSession(value,{code='AUTH_REQUIRED'}={}) {
  if(!record(value)) throw invalid(code);
  const sessionId=own(value,'sessionId',code);
  return Object.freeze({
    tenantId:identifier(own(value,'tenantId',code),code),
    actorId:identifier(own(value,'actorId',code),code),
    roles:labels(own(value,'roles',code),code),
    capabilities:labels(own(value,'capabilities',code),code),
    sessionId:sessionId===undefined?`ses_${crypto.randomUUID()}`:identifier(sessionId,code),
  });
}

// Local synthetic sessions only. Production authentication remains an upstream boundary.
export class StaticAuthProvider {
  #sessions=new Map();
  constructor(sessions = []) {
    const code='AUTH_CONFIGURATION_INVALID';
    if(!Array.isArray(sessions)) throw invalid(code);
    for(const value of sessions) {
      if(!record(value)) throw invalid(code);
      const token=own(value,'token',code);
      if(typeof token!=='string'||token.length>4096||!/^[A-Za-z0-9._~+/-]+=*$/.test(token)||this.#sessions.has(token)) throw invalid(code);
      const supplied=own(value,'sessionId',code);
      const normalized=normalizeSession(value,{code});
      const session=Object.freeze({...normalized,sessionId:supplied===undefined?`ses_${crypto.createHash('sha256').update(token).digest('hex').slice(0,16)}`:normalized.sessionId});
      this.#sessions.set(token,session);
    }
  }
  async authenticate(headers) {
    const code='AUTH_REQUIRED';
    if(!record(headers)) throw invalid(code);
    const lower=own(headers,'authorization',code),upper=own(headers,'Authorization',code);
    if(lower!==undefined&&upper!==undefined) throw invalid(code);
    const raw=lower??upper;
    if(typeof raw!=='string'||raw.length>4103||!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(raw)) throw invalid(code);
    const session=this.#sessions.get(raw.slice(7));
    if(!session) throw invalid(code);
    return session;
  }
}

export function requireCapability(session,capability) {
  let allowed=false;
  try {
    allowed=record(session)&&typeof capability==='string'&&labels(own(session,'capabilities','AUTH_REQUIRED'),'AUTH_REQUIRED').includes(capability);
  } catch { /* Malformed privilege data denies access. */ }
  if(!allowed) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
}

// Signature/issuer/audience verification MUST happen in trusted upstream OIDC middleware.
// __verified is a server-side contract marker, never proof supplied by an HTTP client.
export class VerifiedOidcClaimsMapper {
  #names;
  constructor({tenantClaim='tenant_id',actorClaim='sub',rolesClaim='roles',capabilitiesClaim='capabilities'}={}) {
    const names=[tenantClaim,actorClaim,rolesClaim,capabilitiesClaim];
    if(names.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(name)||['__verified','sid','__proto__','constructor','prototype'].includes(name))||new Set(names).size!==4) throw invalid('AUTH_CONFIGURATION_INVALID');
    this.#names=Object.freeze(names);
  }
  mapVerifiedClaims(claims) {
    if(!record(claims)||own(claims,'__verified','OIDC_VERIFICATION_REQUIRED')!==true) throw invalid('OIDC_VERIFICATION_REQUIRED');
    const code='OIDC_CLAIMS_INVALID';
    const [tenant,actor,roles,capabilities]=this.#names;
    const sid=own(claims,'sid',code);
    return normalizeSession({tenantId:own(claims,tenant,code),actorId:own(claims,actor,code),roles:own(claims,roles,code),capabilities:own(claims,capabilities,code),sessionId:sid===undefined?`oidc_${crypto.randomUUID()}`:sid},{code});
  }
}
