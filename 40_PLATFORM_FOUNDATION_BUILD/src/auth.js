import crypto from 'node:crypto';
import {appError} from './errors.js';

const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const invalid=(code='AUTH_REQUIRED')=>appError(code==='OIDC_VERIFICATION_REQUIRED'?'verified oidc claims required':'authentication required',{status:code==='AUTH_CONFIGURATION_INVALID'?400:401,code});
const MAX_BREAK_GLASS_MS=15*60*1000;
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
function breakGlassGrants(value,code) {
  if(value===undefined) return Object.freeze([]);
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>16) throw invalid(code);
  const result=[];
  for(let i=0;i<value.length;i++) {
    const grant=own(value,String(i),code);
    if(!record(grant)) throw invalid(code);
    const issued=own(grant,'issuedAt',code),expires=own(grant,'expiresAt',code),reason=own(grant,'reason',code),stepUp=own(grant,'stepUpVerified',code);
    const issuedMs=Date.parse(issued),expiresMs=Date.parse(expires);
    if(typeof reason!=='string'||reason.trim().length<8||reason.length>500||/[\u0000-\u001f\u007f]/.test(reason)||stepUp!==true||!Number.isFinite(issuedMs)||!Number.isFinite(expiresMs)||expiresMs<=issuedMs||expiresMs-issuedMs>MAX_BREAK_GLASS_MS) throw invalid(code);
    result.push(Object.freeze({
      grantId:identifier(own(grant,'grantId',code),code),
      matterId:identifier(own(grant,'matterId',code),code),
      reason:reason.trim(),
      issuedAt:new Date(issuedMs).toISOString(),
      expiresAt:new Date(expiresMs).toISOString(),
      stepUpVerified:true,
    }));
  }
  return Object.freeze(result);
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
    securityZoneIds:labels(own(value,'securityZoneIds',code),code),
    matterMembershipIds:labels(own(value,'matterMembershipIds',code),code),
    documentAccessRefs:labels(own(value,'documentAccessRefs',code),code),
    breakGlassGrants:breakGlassGrants(own(value,'breakGlassGrants',code),code),
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

function safeMatter(value) {
  try {
    if(!record(value)) return null;
    const tenantId=identifier(own(value,'tenantId','AUTH_REQUIRED'),'AUTH_REQUIRED');
    const id=identifier(own(value,'id','AUTH_REQUIRED'),'AUTH_REQUIRED');
    const zone=own(value,'securityZoneId','AUTH_REQUIRED');
    const visibility=own(value,'visibility','AUTH_REQUIRED');
    if(zone!==undefined&&zone!==null&&typeof zone!=='string') return null;
    if(visibility!==undefined&&!['STANDARD','TEAM_RESTRICTED','PRIVATE','SECURITY_ZONE'].includes(visibility)) return null;
    return {tenantId,id,securityZoneId:zone??null,visibility:visibility??'STANDARD'};
  } catch { return null; }
}

export function matterAccessAllowed(session,matter,{now=Date.now()}={}) {
  try {
    const s=normalizeSession(session),m=safeMatter(matter);
    if(!m||m.tenantId!==s.tenantId) return false;
    const breakGlass=s.capabilities.includes('matter:break_glass')&&s.breakGlassGrants.some(grant=>grant.matterId===m.id&&grant.stepUpVerified===true&&Date.parse(grant.issuedAt)<=now&&Date.parse(grant.expiresAt)>now);
    if(breakGlass) return true;
    if(m.visibility!=='STANDARD'&&!s.matterMembershipIds.includes(m.id)) return false;
    if(m.securityZoneId&&!s.securityZoneIds.includes(m.securityZoneId)) return false;
    return true;
  } catch { return false; }
}

export function assertMatterAccess(session,matter,options) {
  if(!matterAccessAllowed(session,matter,options)) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
  return true;
}

export function documentAccessAllowed(session,document,matter,{now=Date.now()}={}) {
  try {
    if(!matterAccessAllowed(session,matter,{now})||!record(document)) return false;
    const s=normalizeSession(session);
    const tenantId=identifier(own(document,'tenantId','AUTH_REQUIRED'),'AUTH_REQUIRED');
    const matterId=identifier(own(document,'matterId','AUTH_REQUIRED'),'AUTH_REQUIRED');
    const ref=identifier(own(document,'documentRef','AUTH_REQUIRED'),'AUTH_REQUIRED');
    const mode=own(document,'mode','AUTH_REQUIRED')??'INHERIT';
    const zone=own(document,'securityZoneId','AUTH_REQUIRED');
    if(tenantId!==s.tenantId||matterId!==matter.id||!['INHERIT','RESTRICTED','PRIVILEGED','SECURITY_ZONE'].includes(mode)) return false;
    if(mode==='INHERIT') return true;
    const breakGlass=s.capabilities.includes('matter:break_glass')&&s.breakGlassGrants.some(grant=>grant.matterId===matter.id&&grant.stepUpVerified===true&&Date.parse(grant.issuedAt)<=now&&Date.parse(grant.expiresAt)>now);
    if(breakGlass) return true;
    if(mode==='SECURITY_ZONE') return typeof zone==='string'&&s.securityZoneIds.includes(zone);
    return s.documentAccessRefs.includes(ref);
  } catch { return false; }
}

// Signature/issuer/audience verification MUST happen in trusted upstream OIDC middleware.
// __verified is a server-side contract marker, never proof supplied by an HTTP client.
export class VerifiedOidcClaimsMapper {
  #names;
  constructor({tenantClaim='tenant_id',actorClaim='sub',rolesClaim='roles',capabilitiesClaim='capabilities',securityZonesClaim='security_zones'}={}) {
    const names=[tenantClaim,actorClaim,rolesClaim,capabilitiesClaim,securityZonesClaim];
    if(names.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(name)||['__verified','sid','__proto__','constructor','prototype'].includes(name))||new Set(names).size!==5) throw invalid('AUTH_CONFIGURATION_INVALID');
    this.#names=Object.freeze(names);
  }
  mapVerifiedClaims(claims) {
    if(!record(claims)||own(claims,'__verified','OIDC_VERIFICATION_REQUIRED')!==true) throw invalid('OIDC_VERIFICATION_REQUIRED');
    const code='OIDC_CLAIMS_INVALID';
    const [tenant,actor,roles,capabilities,securityZones]=this.#names;
    const sid=own(claims,'sid',code);
    return normalizeSession({tenantId:own(claims,tenant,code),actorId:own(claims,actor,code),roles:own(claims,roles,code),capabilities:own(claims,capabilities,code),securityZoneIds:own(claims,securityZones,code),sessionId:sid===undefined?`oidc_${crypto.randomUUID()}`:sid},{code});
  }
}

// Production adapter boundary: the injected verifier must perform cryptographic JWT/OIDC
// verification (signature, issuer, audience, lifetime and tenant policy) before returning
// claims. Only this class adds the internal verified marker consumed by the mapper.
export class OidcAuthProvider {
  #verify;#mapper;
  constructor({verifyBearerToken,claimsMapper=new VerifiedOidcClaimsMapper()}={}){
    if(typeof verifyBearerToken!=='function'||!(claimsMapper instanceof VerifiedOidcClaimsMapper))throw invalid('AUTH_CONFIGURATION_INVALID');
    this.#verify=verifyBearerToken;this.#mapper=claimsMapper;
  }
  async authenticate(headers){
    const code='AUTH_REQUIRED';
    if(!record(headers))throw invalid(code);
    const lower=own(headers,'authorization',code),upper=own(headers,'Authorization',code);
    if(lower!==undefined&&upper!==undefined)throw invalid(code);
    const raw=lower??upper;
    if(typeof raw!=='string'||raw.length>8192||!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(raw))throw invalid(code);
    let verified;try{verified=await this.#verify(raw.slice(7));}catch{throw invalid(code);}
    if(!record(verified))throw invalid('OIDC_VERIFICATION_REQUIRED');
    const copy=Object.create(null),descriptors=Object.getOwnPropertyDescriptors(verified);
    for(const key of Reflect.ownKeys(descriptors)){
      if(typeof key!=='string'||key==='__verified'||!Object.hasOwn(descriptors[key],'value'))throw invalid('OIDC_VERIFICATION_REQUIRED');
      copy[key]=descriptors[key].value;
    }
    copy.__verified=true;
    return this.#mapper.mapVerifiedClaims(copy);
  }
}
