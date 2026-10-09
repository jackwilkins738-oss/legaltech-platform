import crypto from 'node:crypto';
import {appError} from './errors.js';
import {normalizeSession} from './auth.js';

const JWT_MAX_BYTES=16*1024;
const JWKS_MAX_BYTES=512*1024;
const DEFAULT_CLOCK_SKEW_MS=60_000;
const DEFAULT_KEY_CACHE_MS=15*60_000;
const DEFAULT_ABSOLUTE_TTL_MS=8*60*60_000;
const DEFAULT_IDLE_TTL_MS=30*60_000;
const COOKIE_NAME='__Host-legaltech_session';
const UNSAFE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
const record=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
const authError=(code='AUTH_REQUIRED')=>appError('authentication required',{status:401,code});
const configError=()=>appError('authentication configuration invalid',{status:500,code:'AUTH_CONFIGURATION_INVALID'});
const referenceSessionAdapters=new WeakSet();
export const usesReferenceSessionStore=adapter=>referenceSessionAdapters.has(adapter);

function identifier(value,{max=512}={}) {
  if(typeof value!=='string'||value.length<1||value.length>max||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value)) throw authError('OIDC_CLAIMS_INVALID');
  return value;
}
function strictHttpsUrl(value) {
  let url;try{url=new URL(value);}catch{throw configError();}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw configError();
  return url;
}
function decodeSegment(segment) {
  if(typeof segment!=='string'||segment.length<1||segment.length>JWT_MAX_BYTES||!/^[A-Za-z0-9_-]+$/.test(segment))throw authError('AUTH_REQUIRED');
  try{return Buffer.from(segment,'base64url');}catch{throw authError('AUTH_REQUIRED');}
}
function parseObject(segment) {
  const bytes=decodeSegment(segment);
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw authError('AUTH_REQUIRED');}
  if(!record(value))throw authError('AUTH_REQUIRED');
  return value;
}
function numericDate(value,{required=false}={}) {
  if(value===undefined&&!required)return null;
  if(!Number.isInteger(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw authError('OIDC_CLAIMS_INVALID');
  return value*1000;
}
function audienceMatches(value,expected) {
  if(typeof value==='string')return value===expected;
  return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length>0&&value.length<=16&&value.every(x=>typeof x==='string')&&value.includes(expected);
}
async function boundedJson(response,maxBytes=JWKS_MAX_BYTES,signal=null) {
  if(!response||response.ok!==true)throw authError('OIDC_KEY_UNAVAILABLE');
  const declared=Number(response.headers?.get?.('content-length')??0);
  if(Number.isFinite(declared)&&declared>maxBytes)throw authError('OIDC_KEY_UNAVAILABLE');
  if(!response.body?.getReader){
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>maxBytes)throw authError('OIDC_KEY_UNAVAILABLE');
    try{return JSON.parse(bytes.toString('utf8'));}catch{throw authError('OIDC_KEY_UNAVAILABLE');}
  }
  const reader=response.body.getReader(),chunks=[];let total=0,complete=false;
  const abort=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    while(true){const {done,value}=await reader.read();if(done){complete=true;break;}total+=value.byteLength;if(total>maxBytes)throw authError('OIDC_KEY_UNAVAILABLE');chunks.push(Buffer.from(value));}
  } finally { signal?.removeEventListener('abort',abort);if(!complete)abort();try{reader.releaseLock();}catch{} }
  try{return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}catch{throw authError('OIDC_KEY_UNAVAILABLE');}
}
function safeJwk(value) {
  if(!record(value)||value.kty!=='RSA'||value.use!=='sig'||value.alg!=='RS256'||typeof value.kid!=='string'||!/^[A-Za-z0-9._:-]{1,256}$/.test(value.kid)||typeof value.n!=='string'||typeof value.e!=='string')return null;
  try{return {kid:value.kid,key:crypto.createPublicKey({key:{kty:'RSA',n:value.n,e:value.e,alg:'RS256',use:'sig',kid:value.kid},format:'jwk'})};}catch{return null;}
}

export class JwksClient {
  #uri;#fetch;#clock;#cacheMs;#timeoutMs;#cooldownMs;#inFlight=null;#lastRefresh=-Infinity;#keys=new Map();#expiresAt=0;
  constructor({jwksUri,fetchImpl=globalThis.fetch,clock=()=>Date.now(),cacheMs=DEFAULT_KEY_CACHE_MS,issuer,timeoutMs=5000,refreshCooldownMs=30000}={}){
    const uri=strictHttpsUrl(jwksUri),issuerUrl=issuer?strictHttpsUrl(issuer):null;
    if(issuerUrl&&uri.origin!==issuerUrl.origin)throw configError();
    if(typeof fetchImpl!=='function'||typeof clock!=='function'||!Number.isInteger(cacheMs)||cacheMs<60_000||cacheMs>60*60_000)throw configError();
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||!Number.isInteger(refreshCooldownMs)||refreshCooldownMs<1000||refreshCooldownMs>60000)throw configError();
    this.#uri=uri.toString();this.#fetch=fetchImpl;this.#clock=clock;this.#cacheMs=cacheMs;this.#timeoutMs=timeoutMs;this.#cooldownMs=refreshCooldownMs;
  }
  async #refresh(){
    if(this.#inFlight)return this.#inFlight;
    if(this.#clock()-this.#lastRefresh<this.#cooldownMs)throw authError('OIDC_KEY_UNAVAILABLE');
    this.#lastRefresh=this.#clock();
    const controller=new AbortController();let timer;
    const work=(async()=>{
      const response=await this.#fetch(this.#uri,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
      const body=await boundedJson(response,JWKS_MAX_BYTES,controller.signal);
      if(controller.signal.aborted||!record(body)||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>64)throw authError('OIDC_KEY_UNAVAILABLE');
      const next=new Map();for(const candidate of body.keys){const parsed=safeJwk(candidate);if(parsed&&!next.has(parsed.kid))next.set(parsed.kid,parsed.key);}
      if(!next.size)throw authError('OIDC_KEY_UNAVAILABLE');
      this.#keys=next;this.#expiresAt=this.#clock()+this.#cacheMs;
    })();
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(authError('OIDC_KEY_UNAVAILABLE'));},this.#timeoutMs);});
    const pending=Promise.race([work,timeout]);this.#inFlight=pending;
    try{await pending;}catch{throw authError('OIDC_KEY_UNAVAILABLE');}finally{clearTimeout(timer);if(this.#inFlight===pending)this.#inFlight=null;}
  }
  async getKey(kid){
    if(typeof kid!=='string'||!/^[A-Za-z0-9._:-]{1,256}$/.test(kid))throw authError('AUTH_REQUIRED');
    let refreshed=false;
    if(this.#clock()>=this.#expiresAt||!this.#keys.size){await this.#refresh();refreshed=true;}
    let key=this.#keys.get(kid);
    if(!key&&!refreshed){await this.#refresh();key=this.#keys.get(kid);}
    if(!key)throw authError('AUTH_REQUIRED');
    return key;
  }
}

export class OidcJwtVerifier {
  #issuer;#audience;#tenants;#jwks;#clock;#skew;
  constructor({issuer,audience,allowedDirectoryTenantIds,jwksClient,clock=()=>Date.now(),clockSkewMs=DEFAULT_CLOCK_SKEW_MS}={}){
    this.#issuer=strictHttpsUrl(issuer).toString().replace(/\/$/,'');
    if(typeof audience!=='string'||audience.length<1||audience.length>512||audience.trim()!==audience)throw configError();
    if(!Array.isArray(allowedDirectoryTenantIds)||allowedDirectoryTenantIds.length<1||allowedDirectoryTenantIds.length>64)throw configError();
    this.#tenants=new Set(allowedDirectoryTenantIds.map(x=>{if(typeof x!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(x))throw configError();return x;}));
    if(!jwksClient||typeof jwksClient.getKey!=='function'||typeof clock!=='function'||!Number.isInteger(clockSkewMs)||clockSkewMs<0||clockSkewMs>5*60_000)throw configError();
    this.#audience=audience;this.#jwks=jwksClient;this.#clock=clock;this.#skew=clockSkewMs;
  }
  async verify(token){
    if(typeof token!=='string'||Buffer.byteLength(token)>JWT_MAX_BYTES)throw authError();
    const parts=token.split('.');if(parts.length!==3)throw authError();
    const header=parseObject(parts[0]);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.jku!==undefined||header.jwk!==undefined)throw authError();
    const claims=parseObject(parts[1]);
    const key=await this.#jwks.getKey(header.kid);
    let signature;try{signature=decodeSegment(parts[2]);}catch{throw authError();}
    const verified=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`,'ascii'),key,signature);
    if(!verified)throw authError();
    const now=this.#clock(),exp=numericDate(claims.exp,{required:true}),nbf=numericDate(claims.nbf),iat=numericDate(claims.iat),authTime=numericDate(claims.auth_time);
    if(claims.iss!==this.#issuer||!audienceMatches(claims.aud,this.#audience)||exp<=now-this.#skew||(nbf!==null&&nbf>now+this.#skew)||(iat!==null&&iat>now+this.#skew)||(authTime!==null&&authTime>now+this.#skew))throw authError('OIDC_CLAIMS_INVALID');
    const tid=identifier(claims.tid,{max:128});
    if(!this.#tenants.has(tid))throw authError('AUTH_REQUIRED');
    const oid=claims.oid===undefined?null:identifier(claims.oid,{max:256});
    const sub=identifier(claims.sub,{max:256});
    const sid=claims.sid===undefined?null:identifier(claims.sid,{max:256});
    const amr=Array.isArray(claims.amr)&&Object.getPrototypeOf(claims.amr)===Array.prototype&&claims.amr.length<=16&&claims.amr.every(x=>typeof x==='string')?[...claims.amr]:[];
    return Object.freeze({issuer:this.#issuer,audience:this.#audience,directoryTenantId:tid,objectId:oid,subject:sub,providerSessionId:sid,expiresAt:new Date(exp).toISOString(),authTime:authTime===null?null:new Date(authTime).toISOString(),mfaVerified:amr.includes('mfa')});
  }
}

function bearer(headers) {
  if(!headers||typeof headers!=='object')throw authError();
  const lower=headers.authorization,upper=headers.Authorization;
  if(lower!==undefined&&upper!==undefined)throw authError();
  const raw=lower??upper;
  if(typeof raw!=='string'||raw.length>JWT_MAX_BYTES+16||!raw.startsWith('Bearer '))throw authError();
  const token=raw.slice(7);if(!token||/\s/.test(token))throw authError();return token;
}

// Production identity resolver boundary. Token claims never directly grant application
// tenant IDs, capabilities, matter membership or document access.
export class ProductionOidcAuthProvider {
  #verifier;#resolve;
  constructor({verifier,resolveIdentity}={}){
    if(!verifier||typeof verifier.verify!=='function'||typeof resolveIdentity!=='function')throw configError();
    this.#verifier=verifier;this.#resolve=resolveIdentity;
  }
  async authenticate(headers){
    const verified=await this.#verifier.verify(bearer(headers));
    let resolved;try{resolved=await this.#resolve(Object.freeze({...verified}));}catch{throw authError();}
    if(!record(resolved))throw authError();
    return normalizeSession({...resolved,authContext:{method:'OIDC',mfaVerified:verified.mfaVerified,authTime:verified.authTime,expiresAt:verified.expiresAt,providerSessionId:verified.providerSessionId}});
  }
}

function sessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token,'utf8').digest('base64url'); }
function validDuration(value,min,max){return Number.isInteger(value)&&value>=min&&value<=max;}

export class InMemoryServerSessionStore {
  #sessions=new Map();#clock;#absolute;#idle;
  constructor({clock=()=>Date.now(),absoluteTtlMs=DEFAULT_ABSOLUTE_TTL_MS,idleTtlMs=DEFAULT_IDLE_TTL_MS}={}){
    if(typeof clock!=='function'||!validDuration(absoluteTtlMs,5*60_000,24*60*60_000)||!validDuration(idleTtlMs,60_000,2*60*60_000)||idleTtlMs>absoluteTtlMs)throw configError();
    this.#clock=clock;this.#absolute=absoluteTtlMs;this.#idle=idleTtlMs;
  }
  issue(session){
    const normalized=normalizeSession(session),now=this.#clock(),token=sessionToken(),key=hashToken(token),expiresAt=Math.min(now+this.#absolute,Date.parse(normalized.authContext.expiresAt??new Date(now+this.#absolute).toISOString()));
    if(!Number.isFinite(expiresAt)||expiresAt<=now)throw authError();
    const stored=Object.freeze({...normalized,authContext:Object.freeze({...normalized.authContext,method:'SERVER_SESSION',expiresAt:new Date(expiresAt).toISOString()})});
    this.#sessions.set(key,{session:stored,createdAt:now,lastSeenAt:now,expiresAt,revoked:false});
    return Object.freeze({token,expiresAt:new Date(expiresAt).toISOString(),maxAgeSeconds:Math.max(1,Math.floor((expiresAt-now)/1000))});
  }
  get(token,{touch=true}={}){
    if(typeof token!=='string'||token.length<32||token.length>256||!/^[A-Za-z0-9_-]+$/.test(token))throw authError();
    const entry=this.#sessions.get(hashToken(token)),now=this.#clock();
    if(!entry||entry.revoked||entry.expiresAt<=now||entry.lastSeenAt+this.#idle<=now){if(entry)this.#sessions.delete(hashToken(token));throw authError();}
    if(touch)entry.lastSeenAt=now;
    return entry.session;
  }
  revoke(token){
    if(typeof token!=='string')return false;const key=hashToken(token),entry=this.#sessions.get(key);if(!entry)return false;entry.revoked=true;this.#sessions.delete(key);return true;
  }
  revokeProviderSession(providerSessionId){
    if(typeof providerSessionId!=='string'||!providerSessionId)return 0;let count=0;
    for(const [key,entry] of this.#sessions){if(entry.session.authContext.providerSessionId===providerSessionId){this.#sessions.delete(key);count++;}}
    return count;
  }
}

function cookieValue(headers,name=COOKIE_NAME) {
  const raw=headers?.cookie??headers?.Cookie;
  if(typeof raw!=='string'||raw.length>8192)throw authError();
  const values=[];
  for(const part of raw.split(';')){const index=part.indexOf('=');if(index<1)continue;const key=part.slice(0,index).trim();if(key===name)values.push(part.slice(index+1).trim());}
  if(values.length!==1||!values[0]||!/^[A-Za-z0-9_-]{32,256}$/.test(values[0]))throw authError();
  return values[0];
}
function exactOrigin(value) {
  let url;try{url=new URL(value);}catch{throw configError();}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw configError();
  return url.origin;
}

export class SessionCookieAuthProvider {
  #store;#origin;#name;
  constructor({store,allowedOrigin,cookieName=COOKIE_NAME}={}){
    if(!store||typeof store.get!=='function'||typeof store.revoke!=='function'||typeof cookieName!=='string'||!/^__Host-[A-Za-z0-9_-]{1,80}$/.test(cookieName))throw configError();
    this.#store=store;this.#origin=exactOrigin(allowedOrigin);this.#name=cookieName;
    if(store instanceof InMemoryServerSessionStore)referenceSessionAdapters.add(this);
  }
  async authenticate(headers,{method='GET'}={}){
    if(headers?.authorization!==undefined||headers?.Authorization!==undefined)throw authError();
    const upper=String(method).toUpperCase();
    if(UNSAFE_METHODS.has(upper)){
      if(headers?.origin!==this.#origin)throw authError('CSRF_CHECK_FAILED');
      const site=headers?.['sec-fetch-site'];if(site!==undefined&&site!=='same-origin')throw authError('CSRF_CHECK_FAILED');
    }
    return this.#store.get(cookieValue(headers,this.#name));
  }
  revoke(headers,{method='POST'}={}){
    const upper=String(method).toUpperCase();if(!UNSAFE_METHODS.has(upper)||headers?.origin!==this.#origin)throw authError('CSRF_CHECK_FAILED');
    return this.#store.revoke(cookieValue(headers,this.#name));
  }
}

function cookieHeader(token,maxAgeSeconds,name=COOKIE_NAME){return `${name}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;}
function clearCookieHeader(name=COOKIE_NAME){return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;}

export class IdentitySessionService {
  #oidc;#store;#cookies;#origin;#interlock;
  constructor({oidcAuthProvider,sessionStore,allowedOrigin,cookieName=COOKIE_NAME,securityInterlock=null}={}){
    if(!oidcAuthProvider||typeof oidcAuthProvider.authenticate!=='function'||!sessionStore||typeof sessionStore.issue!=='function'||typeof sessionStore.revoke!=='function')throw configError();
    if(securityInterlock!==null&&typeof securityInterlock?.assertAllowed!=='function')throw configError();
    if(typeof cookieName!=='string'||!/^__Host-[A-Za-z0-9_-]{1,80}$/.test(cookieName))throw configError();
    this.#oidc=oidcAuthProvider;this.#store=sessionStore;this.#cookies=cookieName;this.#origin=exactOrigin(allowedOrigin);this.#interlock=securityInterlock;
    if(sessionStore instanceof InMemoryServerSessionStore)referenceSessionAdapters.add(this);
  }
  async exchange(headers){
    const session=await this.#oidc.authenticate(headers);
    await this.#interlock?.assertAllowed({tenantId:session.tenantId,actorId:session.actorId,operation:'NEW_SESSION'});
    const issued=await this.#store.issue(session);
    return Object.freeze({session,expiresAt:issued.expiresAt,setCookie:cookieHeader(issued.token,issued.maxAgeSeconds,this.#cookies)});
  }
  async logout(headers){
    const provider=new SessionCookieAuthProvider({store:this.#store,allowedOrigin:this.#origin,cookieName:this.#cookies});
    await provider.revoke(headers,{method:'POST'});
    return Object.freeze({setCookie:clearCookieHeader(this.#cookies)});
  }
}

export {COOKIE_NAME as PRODUCTION_SESSION_COOKIE_NAME};
