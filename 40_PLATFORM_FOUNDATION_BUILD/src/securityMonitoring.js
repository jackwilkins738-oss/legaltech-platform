import crypto from 'node:crypto';

const ALERT_TYPES=new Set(['PRIVILEGED_ACTION','BREAK_GLASS_USED','BULK_READ','CROSS_MATTER_ACCESS','SESSION_CONTEXT_CHANGED','CONNECTOR_FAILURE_BURST']);
const SEVERITIES=new Set(['INFO','MEDIUM','HIGH','CRITICAL']);
const privilegedPrefixes=['GRAPH_','PROCLAIM_','RECOVERY_','BACKUP_','EXPORT_','SUPPORT_'];
const privilegedActions=new Set(['INBOUND_APPROVED','INBOUND_REJECTED','PROCLAIM_RECONCILIATION_REQUESTED']);
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

function safeAlert(input){
  if(!input||typeof input!=='object'||!safeId(input.tenantId)||!ALERT_TYPES.has(input.type)||!SEVERITIES.has(input.severity)||!safeId(input.traceId))throw new Error('INVALID_SECURITY_ALERT');
  for(const key of ['actorId','sessionId','matterId','action','contextHash'])if(input[key]!=null&&!safeId(input[key]))throw new Error('INVALID_SECURITY_ALERT');
  return Object.freeze({
    tenantId:input.tenantId,
    incidentId:safeId(input.incidentId)?input.incidentId:`inc_${crypto.randomUUID()}`,
    type:input.type,severity:input.severity,traceId:input.traceId,
    actorId:input.actorId??null,sessionId:input.sessionId??null,matterId:input.matterId??null,
    action:input.action??null,contextHash:input.contextHash??null,
  });
}

export function canonicalAuditPayload(value){
  const walk=v=>{
    if(Array.isArray(v))return v.map(walk);
    if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,walk(v[k])]));
    return v;
  };
  return JSON.stringify(walk(value));
}
export function auditEntryHash(previousHash,entry){return sha(`${previousHash}\n${canonicalAuditPayload(entry)}`);}
export function verifyAuditChainEntries(entries,{genesis='0'.repeat(64)}={}){
  if(!Array.isArray(entries))return false;
  let previous=genesis;
  for(const raw of entries){
    if(!raw||typeof raw!=='object')return false;
    const {previousHash,entryHash,...base}=raw;
    if(previousHash!==previous||!/^([a-f0-9]{64})$/.test(String(entryHash??''))||auditEntryHash(previousHash,base)!==entryHash)return false;
    previous=entryHash;
  }
  return true;
}

export class SecurityMonitor {
  #store;#now;#windowMs;#bulkReadThreshold;#crossMatterThreshold;#connectorFailureThreshold;#sessions=new Map();#reads=new Map();#matters=new Map();#failures=new Map();#alertSink;
  constructor({store,now=()=>Date.now(),windowMs=60_000,bulkReadThreshold=200,crossMatterThreshold=25,connectorFailureThreshold=3,alertSink=null}={}){
    if(!store||typeof store.securityAlert!=='function'||typeof now!=='function')throw new Error('SECURITY_MONITOR_CONFIGURATION_INVALID');
    this.#store=store;this.#now=now;this.#windowMs=windowMs;this.#bulkReadThreshold=bulkReadThreshold;this.#crossMatterThreshold=crossMatterThreshold;this.#connectorFailureThreshold=connectorFailureThreshold;this.#alertSink=alertSink;
  }
  #emit(input){const alert=safeAlert(input);const stored=this.#store.securityAlert(alert);if(this.#alertSink?.emit)this.#alertSink.emit(stored);return stored;}
  #bucket(map,key){const now=this.#now();let item=map.get(key);if(!item||now-item.startedAt>=this.#windowMs){item={startedAt:now,count:0,values:new Set(),alerted:false};map.set(key,item);}return item;}
  observeRequest({session,req,traceId}){
    if(!session||!safeId(session.tenantId)||!safeId(session.actorId)||!safeId(session.sessionId)||!safeId(traceId))return;
    const raw=`${req?.socket?.remoteAddress??'unknown'}|${req?.headers?.['user-agent']??'unknown'}`;
    const contextHash=sha(raw),key=`${session.tenantId}:${session.sessionId}`,previous=this.#sessions.get(key),now=this.#now();
    if(previous&&previous.contextHash!==contextHash&&now-previous.at<this.#windowMs)this.#emit({tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,traceId,type:'SESSION_CONTEXT_CHANGED',severity:'HIGH',contextHash});
    this.#sessions.set(key,{contextHash,at:now});
  }
  observeRead({session,traceId,resource,count=1,matterIds=[]}){
    if(!session||!safeId(session.tenantId)||!safeId(session.actorId)||!safeId(traceId))return;
    const n=Number(count);if(!Number.isFinite(n)||n<0)return;
    const key=`${session.tenantId}:${session.actorId}:${resource}`,bucket=this.#bucket(this.#reads,key);bucket.count+=n;
    if(bucket.count>=this.#bulkReadThreshold&&!bucket.alerted){bucket.alerted=true;this.#emit({tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,traceId,type:'BULK_READ',severity:'HIGH',action:`READ_${String(resource).toUpperCase()}`});}
    for(const matterId of matterIds)if(safeId(matterId))this.observeMatterAccess({session,traceId,matter:{id:matterId,tenantId:session.tenantId}});
  }
  observeMatterAccess({session,traceId,matter}){
    if(!session||!matter||matter.tenantId!==session.tenantId||!safeId(matter.id)||!safeId(traceId))return;
    const active=(session.breakGlassGrants??[]).some(g=>g?.matterId===matter.id&&g?.stepUpVerified===true&&Date.parse(g.issuedAt)<=this.#now()&&Date.parse(g.expiresAt)>this.#now());
    if(active)this.#emit({tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,traceId,matterId:matter.id,type:'BREAK_GLASS_USED',severity:'CRITICAL',action:'MATTER_READ'});
    const key=`${session.tenantId}:${session.actorId}`,bucket=this.#bucket(this.#matters,key);bucket.values.add(matter.id);
    if(bucket.values.size>=this.#crossMatterThreshold&&!bucket.alerted){bucket.alerted=true;this.#emit({tenantId:session.tenantId,actorId:session.actorId,sessionId:session.sessionId,traceId,matterId:matter.id,type:'CROSS_MATTER_ACCESS',severity:'HIGH',action:'MATTER_READ'});}
  }
  observeAudit(entry){
    if(!entry||!safeId(entry.tenantId)||!safeId(entry.traceId))return;
    const privileged=privilegedActions.has(entry.action)||privilegedPrefixes.some(p=>String(entry.action??'').startsWith(p));
    if(privileged&&entry.outcome==='SUCCESS')this.#emit({tenantId:entry.tenantId,actorId:entry.actorId??null,traceId:entry.traceId,matterId:entry.matterId??null,type:'PRIVILEGED_ACTION',severity:String(entry.action).startsWith('PROCLAIM_WRITE')?'HIGH':'MEDIUM',action:entry.action});
    if(privilegedPrefixes.some(p=>String(entry.action??'').startsWith(p))&&entry.outcome==='FAILED'){
      const key=`${entry.tenantId}:${entry.actorId??'service'}:connector`,bucket=this.#bucket(this.#failures,key);bucket.count+=1;
      if(bucket.count>=this.#connectorFailureThreshold&&!bucket.alerted){bucket.alerted=true;this.#emit({tenantId:entry.tenantId,actorId:entry.actorId??null,traceId:entry.traceId,matterId:entry.matterId??null,type:'CONNECTOR_FAILURE_BURST',severity:'HIGH',action:entry.action});}
    }
  }
}
