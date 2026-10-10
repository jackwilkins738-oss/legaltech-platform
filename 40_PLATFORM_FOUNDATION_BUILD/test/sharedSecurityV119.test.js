// Mandatory security concept: V119 shared security regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresSecurityInterlock,PostgresSecurityInterlockOperator} from '../src/postgresInterlock.js';
import {PostgresAbuseLimiter} from '../src/postgresAbuseControl.js';
import {createPostgresOperationalSecurity} from '../src/postgresOperationalSecurity.js';
import {ControlledExportRegistry} from '../src/exportSafety.js';
import {DocumentDeliveryService} from '../src/documentDelivery.js';
import {ConnectorCredentialBroker} from '../src/secretManagement.js';
import {NotificationDeliveryWorker} from '../src/notificationDelivery.js';
import {PlatformStore} from '../src/store.js';
import {NotificationIntents} from '../src/workflowRuntime.js';

const tenantId='11900000-0000-4000-8000-000000000001',actorId='11900000-0000-4000-8000-000000000011',otherActor='11900000-0000-4000-8000-000000000012';
const key=crypto.randomBytes(32);
const activation={tenantId,actorId,control:'EXPORT',traceId:'v119',incidentId:'synthetic-incident',reasonCode:'CONTAIN'};
const active={tenant_id:tenantId,control:'EXPORT',id:crypto.randomUUID(),status:'ACTIVE',incident_id:activation.incidentId,reason_code:'CONTAIN',activated_by:actorId,activated_at:new Date(),released_by:null,released_at:null,resolution_code:null};
function driver({member=true,privileged=false,owns_schema=false,outside_access=false,grants=true,role='runtime',data=async()=>({rows:[]})}={}) {
  const calls=[],releases=[];
  const pool={connect:async()=>({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member,privileged,owns_schema,outside_access}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
    return data(sql,values);
  },release:destroy=>releases.push(destroy)})};return {pool,calls,releases};
}
const options=x=>({pool:x.pool,expectedRole:'runtime',timeoutMs:100});
const gate=x=>new PostgresSecurityInterlock(options(x));
const operator=(x,authorizeChange=async()=>true)=>new PostgresSecurityInterlockOperator({...options(x),authorizeChange});
function rateDriver({row=null,total=0,commitFails=false,configurationMismatch=false,...options}={}){
  let fingerprint;
  return driver({...options,data:async(sql,values)=>{
    if(sql.startsWith('INSERT INTO operational_security.rate_configuration')){fingerprint=values[0];return {rows:[]};}
    if(sql.startsWith('SELECT fingerprint'))return {rows:[{fingerprint:configurationMismatch?'f'.repeat(64):fingerprint}]};
    if(sql.startsWith('SELECT *,clock_timestamp()'))return {rows:row?[{...row}]:[]};
    if(sql.startsWith('INSERT INTO operational_security.rate_buckets'))return {rows:[{window_id:values[5],records:0,started_at:new Date(),database_now:new Date()}]};
    if(sql.startsWith('UPDATE operational_security.rate_buckets SET window_id'))return {rows:[{window_id:values[1],records:0}]};
    if(sql.startsWith('SELECT count(*)'))return {rows:[{total}]};
    if(sql==='COMMIT'&&commitFails)throw new Error('SECRET_DATABASE_DETAIL');
    return {rows:[]};
  }});
}
const limiter=(x,extra={})=>new PostgresAbuseLimiter({...options(x),hashKey:key,maxPerIp:2,maxPerTenant:3,maxReadRecordsPerActor:3,maxDistinctMattersPerActor:2,...extra});
const read={resource:'documents',count:1,matterIds:['synthetic-legal-id']};
const session={tenantId,actorId,capabilities:[],roles:[]};

test('V119 all-egress and exact-control gates await shared reads and remain tenant-bound',async()=>{
  const x=driver({data:async sql=>sql.startsWith('SELECT control')?{rows:[{control:'ALL_EGRESS'}]}:{rows:[]}});
  await assert.rejects(gate(x).assertAllowed({tenantId,operation:'EXPORT'}),/ACTIVE/);
  assert.equal(await gate(x).assertAllowed({tenantId,operation:'NEW_SESSION'}),true);
  const selects=x.calls.filter(x=>x.sql.startsWith('SELECT control'));assert.ok(selects.every(x=>x.values[0]===tenantId));
});
test('V119 unknown operations and malformed tenant IDs cannot silently pass containment',async()=>{
  const x=driver();await assert.rejects(gate(x).assertAllowed({tenantId,operation:'EXPROT'}),/CONTROL_INVALID/);
  await assert.rejects(gate(x).assertAllowed({tenantId:'bad',operation:'EXPORT'}),/REQUEST_INVALID/);assert.equal(x.calls.length,0);
});
test('V119 unsafe roles and widened privileges stop controls before application queries',async()=>{
  for(const changes of [{member:false},{privileged:true},{owns_schema:true},{outside_access:true},{grants:false},{role:'owner'}]){
    const x=driver(changes);await assert.rejects(gate(x).status(tenantId),/UNAVAILABLE/);
    assert.equal(x.calls.some(x=>x.sql.startsWith('SELECT control')),false);assert.deepEqual(x.releases,[true]);
  }
});
test('V119 database errors are sanitized and failed readers never return an empty allow-list',async()=>{
  const x=driver({data:async()=>{throw new Error('SECRET_SQL_DETAILS')}});
  await assert.rejects(gate(x).status(tenantId),e=>e.message==='SECURITY_INTERLOCK_UNAVAILABLE');
});
test('V119 reader probe rejects disabled or missing FORCE RLS',async()=>{
  for(const rows of [[],[{relname:'interlocks',enabled:true,forced:false,active:true},{relname:'interlock_events',enabled:true,forced:true,active:true}]]){
    const x=driver({data:async sql=>sql.startsWith('SELECT c.relname')?{rows}:{rows:[]}});await assert.rejects(gate(x).probe(),/UNAVAILABLE/);
  }
});
test('V119 asynchronous authorization denial is awaited before locking state can change',async()=>{
  const x=driver();await assert.rejects(operator(x,async()=>false).activate(activation),/FORBIDDEN/);
  assert.equal(x.calls.some(x=>x.sql.startsWith('INSERT INTO operational_security.interlocks')),false);assert.equal(x.calls.some(x=>x.sql==='COMMIT'),false);
});
test('V119 authorization outages fail closed and expose no directory detail',async()=>{
  const x=driver();await assert.rejects(operator(x,async()=>{throw new Error('SECRET_DIRECTORY')}).activate(activation),e=>e.message==='SECURITY_INTERLOCK_AUTHORIZATION_UNAVAILABLE');
});
test('V119 identical active incident replays and conflicting incident cannot overwrite containment',async()=>{
  const x=driver({data:async sql=>sql.startsWith('SELECT * FROM operational_security.interlocks')?{rows:[active]}:{rows:[]}});
  assert.equal((await operator(x).activate(activation)).replayed,true);
  await assert.rejects(operator(x).activate({...activation,incidentId:'different'}),/ALREADY_ACTIVE/);
  assert.equal(x.calls.some(x=>x.sql.startsWith('INSERT INTO operational_security.interlocks')),false);
});
test('V119 activation returns only after COMMIT and an uncertain commit is distinguished',async()=>{
  const x=driver({data:async sql=>sql.startsWith('INSERT INTO operational_security.interlocks')?{rows:[active]}:{rows:[]}});
  assert.equal((await operator(x).activate(activation)).status,'ACTIVE');assert.ok(x.calls.some(x=>x.sql==='COMMIT'));assert.deepEqual(x.releases,[false]);
  const failed=driver({data:async sql=>{if(sql==='COMMIT')throw new Error('SECRET');return {rows:[active]}}});
  await assert.rejects(operator(failed).activate(activation),/OUTCOME_UNKNOWN/);
});
test('V119 same activating actor cannot release and a different authorised actor is bound to SQL',async()=>{
  const x=driver({data:async sql=>sql.startsWith('SELECT *')?{rows:[active]}:sql.startsWith('UPDATE operational_security.interlocks')?{rows:[{...active,status:'RELEASED',released_by:otherActor,released_at:new Date(),resolution_code:'RESOLVED'}]}:{rows:[]}});
  const release={tenantId,actorId,control:'EXPORT',interlockId:active.id,incidentId:active.incident_id,traceId:'r',resolutionCode:'RESOLVED'};
  await assert.rejects(operator(x).release(release),/DUAL_CONTROL/);
  assert.equal((await operator(x).release({...release,actorId:otherActor})).releasedBy,otherActor);
  assert.equal(x.calls.find(x=>x.sql.startsWith('UPDATE operational_security.interlocks')).values[2],otherActor);
});
test('V119 rate limiter rejects invalid policy, weak key and missing socket context',()=>{
  const x=rateDriver();for(const extra of [{hashKey:Buffer.alloc(8)},{windowMs:0},{maxPerTenant:0},{maxDistinctMattersPerActor:100001}])assert.throws(()=>limiter(x,extra),/CONFIGURATION_INVALID/);
  assert.throws(()=>limiter(x).checkIp({headers:{'x-forwarded-for':'203.0.113.1'}}),e=>e.status===503);
});
test('V119 uninitialised and mismatched shared configuration fail closed before bucket access',async()=>{
  const x=rateDriver(),s=limiter(x);await assert.rejects(s.checkTenant(session),e=>e.status===503);
  assert.equal(x.calls.some(x=>x.sql.includes('FROM operational_security.rate_buckets')),false);
  const mismatch=rateDriver({configurationMismatch:true});await assert.rejects(limiter(mismatch).initialize(),/UNAVAILABLE/);
});
test('V119 accepted read commits and persists only opaque keyed hashes',async()=>{
  const x=rateDriver({total:1}),s=limiter(x);await s.initialize();assert.equal(await s.checkRead(session,read),true);
  const calls=JSON.stringify(x.calls);assert.equal(calls.includes('synthetic-legal-id'),false);assert.equal(calls.includes(tenantId),false);assert.equal(calls.includes(actorId),false);
  const insert=x.calls.find(x=>x.sql.startsWith('INSERT INTO operational_security.read_matters'));assert.match(insert.values[0],/^[a-f0-9]{64}$/);assert.match(insert.values[2][0],/^[a-f0-9]{64}$/);
  assert.deepEqual(x.releases,[false,false]);
});
test('V119 endpoints share actor budget and duplicate matter IDs cannot inflate distinct accounting',async()=>{
  const x=rateDriver({total:1}),s=limiter(x);await s.initialize();
  await s.checkRead(session,{resource:'matters',count:1,matterIds:['m','m']});await s.checkRead(session,{resource:'documents',count:1,matterIds:['m']});
  const buckets=x.calls.filter(x=>x.sql.startsWith('SELECT *,clock_timestamp()'));assert.equal(buckets[0].values[0],buckets[1].values[0]);
  const inserts=x.calls.filter(x=>x.sql.startsWith('INSERT INTO operational_security.read_matters'));assert.equal(inserts[0].values[2].length,1);
});
test('V119 distinct-matter denial returns 429 and rolls back without incrementing records',async()=>{
  const x=rateDriver({total:3}),s=limiter(x);await s.initialize();await assert.rejects(s.checkRead(session,read),e=>e.code==='READ_VOLUME_LIMITED'&&e.status===429);
  assert.equal(x.calls.some(x=>x.sql.startsWith('UPDATE operational_security.rate_buckets SET records')),false);assert.deepEqual(x.releases,[false,true]);
});
test('V119 saturated shared tenant budget denies another instance without resetting a live window',async()=>{
  const now=new Date(),x=rateDriver({row:{scope:'TENANT',window_ms:60000,record_limit:3,matter_limit:0,window_id:crypto.randomUUID(),records:3,started_at:now,database_now:now}}),s=limiter(x);await s.initialize();
  await assert.rejects(s.checkTenant(session),e=>e.code==='RATE_LIMITED');assert.equal(x.calls.some(x=>x.sql.startsWith('UPDATE operational_security.rate_buckets SET window_id')),false);
});
test('V119 database-time window expiry deletes old distinct set before resetting its FK generation',async()=>{
  const now=new Date(),x=rateDriver({total:1,row:{scope:'READ',window_ms:60000,record_limit:3,matter_limit:2,window_id:crypto.randomUUID(),records:3,started_at:new Date(now-60001),database_now:now}}),s=limiter(x);await s.initialize();await s.checkRead(session,read);
  const statements=x.calls.map(x=>x.sql);assert.ok(statements.findIndex(x=>x.startsWith('DELETE FROM operational_security.read_matters'))<statements.findIndex(x=>x.startsWith('UPDATE operational_security.rate_buckets SET window_id')));
});
test('V119 clock rollback and per-bucket policy drift deny serving data',async()=>{
  for(const row of [{scope:'TENANT',window_ms:60000,record_limit:3,matter_limit:0,records:0,started_at:new Date(Date.now()+10000),database_now:new Date()}, {scope:'TENANT',window_ms:60000,record_limit:4,matter_limit:0,records:0}]){
    const x=rateDriver({row}),s=limiter(x);await s.initialize();await assert.rejects(s.checkTenant(session),e=>e.status===503);
  }
});
test('V119 uncertain budget COMMIT fails closed even if a debit might have persisted',async()=>{
  let fail=false;const x=rateDriver();const original=x.pool.connect;x.pool.connect=async()=>{const client=await original();const query=client.query;client.query=async(...args)=>{if(fail&&args[0]==='COMMIT')throw new Error('SECRET_COMMIT');return query(...args)};return client};
  const s=limiter(x);await s.initialize();fail=true;await assert.rejects(s.checkTenant(session),e=>e.status===503&&e.code==='RATE_LIMIT_STORE_UNAVAILABLE');
});
test('V119 forwarded-header changes cannot change peer bucket and mapped IPv4 is canonicalised',async()=>{
  const x=rateDriver(),s=limiter(x);await s.initialize();
  await s.checkIp({socket:{remoteAddress:'203.0.113.119'},headers:{'x-forwarded-for':'one'}});
  await s.checkIp({socket:{remoteAddress:'::ffff:203.0.113.119'},headers:{'x-forwarded-for':'two'}});
  const reads=x.calls.filter(x=>x.sql.startsWith('SELECT *,clock_timestamp()'));assert.equal(reads[0].values[0],reads[1].values[0]);assert.equal(JSON.stringify(x.calls).includes('203.0.113'),false);
});
test('V119 malformed read context cannot debit a valid actor budget',()=>{
  const x=rateDriver(),s=limiter(x);for(const bad of [{resource:'../bad'},{resource:'matters',count:10001},{resource:'matters',matterIds:['\u0000']},{resource:'matters',count:'1'}])assert.throws(()=>s.checkRead(session,bad));
  assert.equal(x.calls.length,0);
});
test('V119 composition binds gate and limiter probes without exposing an operator',()=>{
  const x=driver();const result=createPostgresOperationalSecurity({readerPool:x.pool,expectedReaderRole:'runtime',limiterPool:x.pool,expectedLimiterRole:'runtime',hashKey:key});
  assert.equal(typeof result.securityInterlock.assertAllowed,'function');assert.equal(typeof result.abuseLimiter.checkRead,'function');assert.equal(result.operator,undefined);
  assert.throws(()=>createPostgresOperationalSecurity({readerPool:x.pool,expectedReaderRole:'runtime',limiterPool:x.pool,expectedLimiterRole:'runtime',hashKey:key,ratePolicy:{pool:x.pool}}),/CONFIGURATION_INVALID/);
});
test('V119 synchronous export refuses async containment and cannot create an export',()=>{
  const registry=new ControlledExportRegistry({authorizeResource:()=>true,validateStorageRef:()=>true,securityInterlock:{assertAllowed:async()=>{throw new Error('SECURITY_INTERLOCK_ACTIVE')}}});
  assert.throws(()=>registry.requestExport({tenantId:'t',actorId:'a',traceId:'tr',resourceSet:[{resourceClass:'DOCUMENT',resourceRef:'d'}],format:'ZIP',idempotencyKey:'i'}),/ASYNC_SECURITY_INTERLOCK_REQUIRED/);
  assert.equal(registry.listEvents('t').length,0);
});
test('V119 document issue waits for containment and never resolves content on async denial',async()=>{
  let resolved=0;const service=new DocumentDeliveryService({resolveDocument:async()=>{resolved++;return null},objectStorage:{get:()=>Buffer.alloc(0)},securityInterlock:{assertAllowed:async()=>{throw new Error('SECURITY_INTERLOCK_ACTIVE')}}});
  await assert.rejects(service.issueGrant({session,documentRef:'doc',traceId:'v119',ttlMs:1000}),/ACTIVE/);assert.equal(resolved,0);
});
test('V119 connector async denial stops provider lookup before acquiring credential bytes',async()=>{
  let resolved=0;const broker=new ConnectorCredentialBroker({provider:{resolve:async()=>{resolved++;throw new Error('unused')}},securityInterlock:{assertAllowed:async()=>{throw new Error('SECURITY_INTERLOCK_ACTIVE')}}});
  await assert.rejects(broker.withCredential({tenantId:'t',kind:'PROCLAIM',credentialRef:'secret://azure-kv/vault/key',purpose:'write',capabilities:['write']},async()=>true),/ACTIVE/);assert.equal(resolved,0);
});
test('V119 notification async denial defers explicit external channel without claiming work',async()=>{
  const store=new PlatformStore(':memory:');try{
    const intents=new NotificationIntents({store}),intent=intents.enqueue({tenantId:'t',channel:'TEAMS',templateId:'T',recipient:{kind:'USER',id:'u'},objectType:'WORK',objectId:'w',dedupeKey:'v119',severity:'NORMAL',traceId:'tr'});
    let sent=0;const worker=new NotificationDeliveryWorker({store,notificationIntents:intents,adapters:{TEAMS:{deliver:async()=>{sent++;return {deliveryRef:'unused'}}}},securityInterlock:{assertAllowed:async()=>{throw new Error('SECURITY_INTERLOCK_ACTIVE')}}});
    assert.equal((await worker.processNext({tenantId:'t',channel:'TEAMS'})).status,'DEFERRED');assert.equal(sent,0);assert.equal(store.getNotificationIntent('t',intent.id).status,'QUEUED');
  }finally{store.close();}
});
test('V119 connector containment activated during provider lookup blocks consumer and wipes acquired bytes',async()=>{
  let blocked=false,consumed=0;const source=crypto.randomBytes(32);
  const broker=new ConnectorCredentialBroker({provider:{resolve:async req=>{blocked=true;return {value:source,generation:1,expiresAt:new Date(Date.now()+60000).toISOString(),state:'ACTIVE',tenantId:req.tenantId,kind:req.kind}}},securityInterlock:{assertAllowed:async()=>{if(blocked)throw new Error('SECURITY_INTERLOCK_ACTIVE');return true}}});
  await assert.rejects(broker.withCredential({tenantId:'t',kind:'PROCLAIM',credentialRef:'secret://proclaim/tenant',purpose:'WRITE',capabilities:['WRITE']},async()=>{consumed++;return true}),/ACTIVE/);
  assert.equal(consumed,0);assert.ok(source.every(x=>x===0));
});
test('V119 document redemption rechecks async containment after resolver before reading bytes',async()=>{
  const bytes=Buffer.from('synthetic'),sha=crypto.createHash('sha256').update(bytes).digest('hex');let blockDuringResolve=false,blocked=false,reads=0;
  const service=new DocumentDeliveryService({resolveDocument:async()=>{
    if(blockDuringResolve)blocked=true;
    return {document:{tenantId,matterId:'m',documentRef:'d',mode:'INHERIT'},matter:{id:'m',tenantId,visibility:'STANDARD'},objectRef:`${tenantId}/${sha}`,sha256:sha,size:bytes.length,contentType:'application/pdf'};
  },objectStorage:{get:()=>{reads++;return bytes}},securityInterlock:{assertAllowed:async()=>{if(blocked)throw new Error('SECURITY_INTERLOCK_ACTIVE');return true}}});
  const grant=await service.issueGrant({session,documentRef:'d',traceId:'issue',ttlMs:60000});blockDuringResolve=true;
  await assert.rejects(service.consumeGrant({session,documentRef:'d',grantId:grant.grantId,token:grant.token,traceId:'get'}),/ACTIVE/);assert.equal(reads,0);
});
test('V119 writeback awaits remote containment before reserving or sending a write',async()=>{
  const {Platform}=await import('../src/platform.js'),{DeterministicAIGateway}=await import('../src/aiGateway.js');
  const store=new PlatformStore(':memory:',{matters:[{id:'m',tenantId:'t',externalId:'P',externalRefs:['CLM-10001']}]});
  let writes=0;const objects=new Map();const objectStorage={put:({tenantId,bytes})=>{const hash=crypto.createHash('sha256').update(bytes).digest('hex'),objectRef=`${tenantId}/${hash}`;objects.set(objectRef,bytes);return {objectRef,hash,size:bytes.length}},get:({objectRef})=>objects.get(objectRef)};
  const platform=new Platform({store,objectStorage,aiGateway:new DeterministicAIGateway(),proclaim:{createHistory:async()=>{writes++;return {externalWriteId:'unused'}},getHistory:async()=>[]},securityInterlock:{assertAllowed:async()=>{throw new Error('SECURITY_INTERLOCK_ACTIVE')}}});
  try{
    const event=platform.ingest({tenantId:'t',idempotencyKey:'v119-ingest',input:{subject:'CLM-10001'}});await platform.processNext({tenantId:'t',eventId:event.eventId});
    platform.approve({tenantId:'t',eventId:event.eventId,actorId:'reviewer',idempotencyKey:'v119-approve'});
    assert.equal((await platform.processWritebackNext({tenantId:'t',eventId:event.eventId})).status,'DEFERRED');assert.equal(writes,0);
  }finally{store.close();}
});
