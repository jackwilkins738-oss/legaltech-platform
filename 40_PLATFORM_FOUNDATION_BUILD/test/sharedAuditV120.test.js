// Mandatory security concept: V120 shared audit regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {canonicalAuditPayload,auditEntryHash} from '../src/securityMonitoring.js';
import {PostgresAuditWriter,PostgresAuditReader,createPostgresAuditBoundary} from '../src/postgresAudit.js';

const tenantId='12000000-0000-4000-8000-000000000001',otherTenant='12000000-0000-4000-8000-000000000002';
const genesis='0'.repeat(64),at='2026-10-09T12:00:00.000Z';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const input=()=>({tenantId,eventId:crypto.randomUUID(),actorId:'actor-1',traceId:'trace-1',action:'READ_APPROVED',outcome:'SUCCESS',objectId:'opaque-doc-1',matterId:'opaque-matter-1',reasonCode:'AUTHORIZED'});
function record(event=input(),pos=1,previous=genesis){
  const base={version:1,tenantId:event.tenantId,eventId:event.eventId,actorHash:sha(event.actorId),traceHash:sha(event.traceId),action:event.action,outcome:event.outcome,objectHash:event.objectId?sha(event.objectId):null,matterHash:event.matterId?sha(event.matterId):null,reasonCode:event.reasonCode??null};
  const requestHash=sha(canonicalAuditPayload(base)),payload={...base,position:pos,createdAt:at,requestHash};
  return {tenant_id:event.tenantId,event_id:event.eventId,position:String(pos),created_at:at,request_hash:requestHash,previous_hash:previous,entry_hash:auditEntryHash(previous,payload),canonical_payload:canonicalAuditPayload(payload)};
}
const triggerRows=[['tenant_heads','protect_audit_head'],['entries','validate_audit_entry'],['entries','advance_audit_head'],['entries','audit_entries_no_update_delete'],['entries','audit_entries_no_truncate']].map(([relname,tgname])=>({relname,tgname,tgenabled:'O'}));
function driver({rows=[],headRow,member=true,grants=true,role='runtime',privileged=false,owns_schema=false,outside_access=false,disabledTrigger=false,failCommit=false,failData=false,advance=true,mutateInsert=null,reportedCount=null}={}) {
  const entries=structuredClone(rows),calls=[],releases=[];
  let head=headRow===undefined?(rows.length?{position:String(rows.length),head_hash:rows.at(-1).entry_hash}:null):headRow;
  const pool={connect:async()=>({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member,privileged,owns_schema,outside_access}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
    if(sql.includes('FROM pg_trigger'))return {rows:disabledTrigger?triggerRows.slice(1):triggerRows};
    if(sql.startsWith('SELECT c.relname'))return {rows:values[0].map(relname=>({relname,enabled:true,forced:true,active:true}))};
    if(sql==='COMMIT'&&failCommit)throw new Error('SECRET_DATABASE_DETAIL');
    if(failData&&sql.includes('audit_security.'))throw new Error('SECRET_SQL_DETAIL');
    if(sql.startsWith('INSERT INTO audit_security.tenant_heads')){head??={position:'0',head_hash:genesis};return {rows:[]};}
    if(sql.startsWith('SELECT position,head_hash'))return {rows:head?[{...head}]:[]};
    if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{stamp:at}]};
    if(sql.startsWith('SELECT * FROM audit_security.entries')&&sql.includes('event_id='))return {rows:entries.filter(x=>x.tenant_id===values[0]&&x.event_id===values[1])};
    if(sql.startsWith('SELECT * FROM audit_security.entries')&&sql.includes('position>='))return {rows:entries.filter(x=>x.tenant_id===values[0]&&Number(x.position)>=values[1]&&Number(x.position)<=values[2]).slice(0,1000)};
    if(sql.startsWith('SELECT * FROM audit_security.entries'))return {rows:entries.filter(x=>x.tenant_id===values[0]&&Number(x.position)===values[1])};
    if(sql.startsWith('SELECT count(*)'))return {rows:[{total:String(reportedCount??entries.filter(x=>x.tenant_id===values[0]).length)}]};
    if(sql.startsWith('INSERT INTO audit_security.entries')){
      let row={tenant_id:values[0],position:String(values[1]),event_id:values[2],created_at:values[3],request_hash:values[4],previous_hash:values[5],entry_hash:values[6],canonical_payload:values[7]};
      if(mutateInsert)row=mutateInsert(row);entries.push(row);if(advance)head={position:row.position,head_hash:row.entry_hash};return {rows:[row]};
    }
    return {rows:[]};
  },release:destroy=>releases.push(destroy)})};return {pool,calls,releases,entries};
}
const options=x=>({pool:x.pool,expectedRole:'runtime',timeoutMs:100});
const writer=x=>new PostgresAuditWriter(options(x));
const reader=(x,extra={})=>new PostgresAuditReader({...options(x),...extra});

test('V120 stable event issuance commits before receipt and keeps raw identifiers/content out of storage',async()=>{
  const x=driver(),event=input(),receipt=await writer(x).append(event);
  assert.equal(receipt.position,1);assert.equal(receipt.previousHash,genesis);assert.equal(receipt.replayed,false);assert.deepEqual(x.releases,[false]);
  const stored=x.calls.find(x=>x.sql.startsWith('INSERT INTO audit_security.entries'));for(const field of ['actorId','traceId','objectId','matterId'])assert.equal(JSON.stringify(stored).includes(event[field]),false);
  assert.ok(x.calls.some(x=>x.sql==='COMMIT'));assert.match(receipt.entryHash,/^[a-f0-9]{64}$/);
});
test('V120 appended predecessor uses existing tenant head and validates last persisted row',async()=>{
  const first=record(),x=driver({rows:[first]});const next=await writer(x).append(input());assert.equal(next.position,2);assert.equal(next.previousHash,first.entry_hash);
});
test('V120 same event replays a validated receipt without allocating a new sequence',async()=>{
  const event=input(),first=record(event),x=driver({rows:[first]});assert.equal((await writer(x).append(event)).replayed,true);
  assert.equal(x.calls.some(x=>x.sql.startsWith('INSERT INTO audit_security.entries')),false);
});
test('V120 event ID reused with different binding or outcome cannot overwrite prior evidence',async()=>{
  const event=input();for(const change of [{outcome:'FAILED'},{actorId:'other'},{objectId:'other'},{reasonCode:'DENIED'}]){
    const x=driver({rows:[record(event)]});await assert.rejects(writer(x).append({...event,...change}),/AUDIT_EVENT_CONFLICT/);assert.deepEqual(x.releases,[true]);
  }
});
test('V120 untrusted payload keys and free-text reasons are rejected before any checkout',async()=>{
  for(const change of [{emailBody:'sensitive body'},{reasonCode:'client called with medical details'},{action:'mixedCase'},{tenantId:'bad'},{eventId:'bad'}]){
    const x=driver();await assert.rejects(writer(x).append({...input(),...change}),/AUDIT_INPUT_INVALID/);assert.equal(x.calls.length,0);
  }
});
test('V120 unsafe role/grants or wrong login cannot append or verify',async()=>{
  for(const bad of [{member:false},{grants:false},{role:'owner'},{privileged:true},{owns_schema:true},{outside_access:true}]){
    const x=driver(bad);await assert.rejects(writer(x).append(input()),/STORE_UNAVAILABLE/);assert.equal(x.calls.some(x=>x.sql.startsWith('INSERT INTO audit_security.entries')),false);
    await assert.rejects(reader(x).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
  }
});
test('V120 disabled integrity triggers block even a replay and cannot create an allow result',async()=>{
  const event=input(),x=driver({rows:[record(event)],disabledTrigger:true});await assert.rejects(writer(x).append(event),/UNAVAILABLE/);await assert.rejects(reader(x).verify({tenantId}),/UNAVAILABLE/);
});
test('V120 corrupt last record and invalid genesis prevent a new append',async()=>{
  const corrupt=record();corrupt.canonical_payload=corrupt.canonical_payload.replace('SUCCESS','FAILED');
  for(const bad of [{rows:[corrupt]},{headRow:{position:'0',head_hash:'f'.repeat(64)}},{headRow:{position:'9007199254740991',head_hash:'f'.repeat(64)}}]){
    const x=driver(bad);await assert.rejects(writer(x).append(input()),/UNAVAILABLE/);assert.equal(x.calls.some(x=>x.sql.startsWith('INSERT INTO audit_security.entries')),false);
  }
});
test('V120 inconsistent returned insert or missing head advance rolls back instead of returning success',async()=>{
  for(const bad of [{advance:false},{mutateInsert:row=>({...row,entry_hash:'f'.repeat(64)})}]){const x=driver(bad);await assert.rejects(writer(x).append(input()),/UNAVAILABLE/);assert.deepEqual(x.releases,[true]);}
});
test('V120 uncertain audit COMMIT is distinguished so only the same event ID can be reconciled',async()=>{
  const x=driver({failCommit:true});await assert.rejects(writer(x).append(input()),e=>e.message==='AUDIT_APPEND_OUTCOME_UNKNOWN');assert.deepEqual(x.releases,[true]);
});
test('V120 database failures are sanitized and do not return optimistic audit success',async()=>{
  const x=driver({failData:true});await assert.rejects(writer(x).append(input()),e=>e.message==='AUDIT_STORE_UNAVAILABLE');await assert.rejects(reader(x).verify({tenantId}),e=>e.message==='AUDIT_INTEGRITY_UNAVAILABLE');
});
test('V120 verification starts repeatable-read before any snapshot query and remains tenant-bound',async()=>{
  const first=record(),x=driver({rows:[first]});const result=await reader(x).verify({tenantId});assert.equal(result.ok,true);assert.equal(result.anchorVerified,false);
  assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(x.calls.filter(x=>x.sql.includes('WHERE tenant_id=')).every(x=>x.values[0]===tenantId));
});
test('V120 trusted anchor verifies a prefix of an extended chain',async()=>{
  const first=record(),second=record(input(),2,first.entry_hash),x=driver({rows:[first,second]});
  const result=await reader(x,{resolveTrustedAnchor:async()=>({tenantId,auditCount:1,headHash:first.entry_hash})}).verify({tenantId});assert.equal(result.auditCount,2);assert.equal(result.anchorVerified,true);
});
test('V120 missing or invalid trusted anchors cannot satisfy readiness',async()=>{
  const first=record(),x=driver({rows:[first]});await assert.rejects(reader(x).probe(tenantId),/TRUSTED_ANCHOR_REQUIRED/);
  for(const anchor of [null,{tenantId:otherTenant,auditCount:1,headHash:first.entry_hash},{tenantId,auditCount:2,headHash:first.entry_hash},{tenantId,auditCount:1,headHash:'f'.repeat(64)}])await assert.rejects(reader(x,{resolveTrustedAnchor:async()=>anchor}).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 independent anchor detects database rollback despite an internally valid shorter chain',async()=>{
  const first=record(),second=record(input(),2,first.entry_hash),x=driver({rows:[first]});await assert.rejects(reader(x,{resolveTrustedAnchor:async()=>({tenantId,auditCount:2,headHash:second.entry_hash})}).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 forged fork with internally consistent hashes still fails its trusted prefix',async()=>{
  const original=record(),fork=record({...input(),eventId:original.event_id,outcome:'FAILED'}),x=driver({rows:[fork]});
  await assert.rejects(reader(x,{resolveTrustedAnchor:async()=>({tenantId,auditCount:1,headHash:original.entry_hash})}).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 chain gaps, broken links, forged head and excess rows are integrity failures',async()=>{
  const first=record(),second=record(input(),2,first.entry_hash);
  for(const bad of [{rows:[second],headRow:{position:'2',head_hash:second.entry_hash}},{rows:[first,{...second,previous_hash:genesis}]},{rows:[first],headRow:{position:'1',head_hash:'f'.repeat(64)}},{rows:[first],reportedCount:2}])await assert.rejects(reader(driver(bad)).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 verification pages bounded contiguous ranges and rejects over-budget histories',async()=>{
  const rows=[];for(let i=1;i<=1001;i++)rows.push(record(input(),i,rows.at(-1)?.entry_hash??genesis));
  const x=driver({rows});assert.equal((await reader(x).verify({tenantId})).auditCount,1001);
  assert.equal(x.calls.filter(x=>x.sql.includes('position>=')).length,2);await assert.rejects(reader(x,{maxVerificationEntries:1000}).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 forged request fingerprints and noncanonical JSON bytes are rejected',async()=>{
  const first=record();for(const bad of [{...first,request_hash:'f'.repeat(64)},{...first,canonical_payload:first.canonical_payload.replace('{','{ ')},{...first,tenant_id:otherTenant}])await assert.rejects(reader(driver({rows:[bad]})).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
test('V120 a stalled independent anchor times out and discards the snapshot connection',async()=>{
  const x=driver({rows:[record()]});await assert.rejects(reader(x,{resolveTrustedAnchor:async()=>new Promise(()=>{})}).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);assert.deepEqual(x.releases,[true]);
});
test('V120 audit readiness performs a stable canary append and requires independent verification',async()=>{
  const x=driver(),w=writer(x),eventId=crypto.randomUUID();assert.equal((await w.probe({tenantId,eventId})).ok,true);assert.equal((await w.probe({tenantId,eventId})).ok,true);assert.equal(x.entries.length,1);
  const r=reader(x,{resolveTrustedAnchor:async()=>({tenantId,auditCount:1,headHash:x.entries[0].entry_hash})});assert.equal((await r.probe(tenantId)).ok,true);
});
test('V120 production boundary requires stable canary identities and anchor resolver',()=>{
  const x=driver();assert.throws(()=>createPostgresAuditBoundary({writerPool:x.pool,readerPool:x.pool,expectedWriterRole:'runtime',expectedReaderRole:'runtime',readinessTenantId:tenantId,probeEventId:crypto.randomUUID()}),/TRUSTED_ANCHOR_REQUIRED/);
  const boundary=createPostgresAuditBoundary({writerPool:x.pool,readerPool:x.pool,expectedWriterRole:'runtime',expectedReaderRole:'runtime',readinessTenantId:tenantId,probeEventId:crypto.randomUUID(),resolveTrustedAnchor:async()=>null});assert.equal(typeof boundary.auditProbe,'function');assert.equal(Object.isFrozen(boundary),true);
});
test('V120 an internally rehashed timestamp regression still fails chronology verification',async()=>{
  const first=record(),second=record(input(),2,first.entry_hash),payload=JSON.parse(second.canonical_payload);
  payload.createdAt='2026-10-09T11:59:59.000Z';second.created_at=payload.createdAt;second.canonical_payload=canonicalAuditPayload(payload);second.entry_hash=auditEntryHash(first.entry_hash,payload);
  await assert.rejects(reader(driver({rows:[first,second]})).verify({tenantId}),/INTEGRITY_UNAVAILABLE/);
});
