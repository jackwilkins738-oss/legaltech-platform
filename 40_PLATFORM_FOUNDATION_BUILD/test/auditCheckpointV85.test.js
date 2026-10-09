import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformStore} from '../src/store.js';
import {AuditCheckpointService,MemoryAuditAnchor,createAuditCheckpointReadinessProbe} from '../src/auditCheckpoint.js';

function fixture({anchor=true,requireAnchor=anchor,anchorVerifier=true}={}){
  const store=new PlatformStore(':memory:');
  const memory=anchor?new MemoryAuditAnchor():null;
  const svc=new AuditCheckpointService({store,anchorSink:memory,anchorVerifier:anchorVerifier?memory:null,requireAnchor,now:()=>1_800_000_000_000});
  return {store,memory,svc,close:()=>store.close()};
}
const audit=(store,tenantId='ta',n=1)=>{for(let i=0;i<n;i++)store.audit({tenantId,traceId:`tr-${tenantId}-${i}-${cryptoRand()}`,actorId:'u1',action:`TEST_${i}`,objectId:`o${i}`,outcome:'SUCCESS',reason:'synthetic'});};
let counter=0; const cryptoRand=()=>++counter;
const create=(svc,tenantId='ta',key='k1')=>svc.create({tenantId,actorId:'u1',traceId:`cp-${key}`,idempotencyKey:key});


test('anchored checkpoint stores only hashes and immutable bounded metadata',async()=>{
  const x=fixture();try{
    audit(x.store,'ta',2);const cp=await create(x.svc);
    assert.match(cp.checkpointHash,/^[a-f0-9]{64}$/);assert.match(cp.anchorRefHash,/^[a-f0-9]{64}$/);assert.equal(cp.auditCount,2);
    const raw=x.store.db.prepare('SELECT data_json FROM audit_checkpoints WHERE id=?').get(cp.id).data_json;
    assert.equal(raw.includes('anchor_'),false);assert.equal(raw.includes('TEST_'),false);assert.equal(raw.includes('synthetic'),false);
    assert.throws(()=>x.store.db.prepare("UPDATE audit_checkpoints SET head_hash='"+'0'.repeat(64)+"' WHERE id=?").run(cp.id),/append-only/);
    assert.throws(()=>x.store.db.prepare('DELETE FROM audit_checkpoints WHERE id=?').run(cp.id),/append-only/);
  }finally{x.close();}
});

test('checkpoint creation is idempotent per tenant and key',async()=>{
  const x=fixture();try{audit(x.store);const a=await create(x.svc,'ta','same'),b=await create(x.svc,'ta','same');assert.equal(b.id,a.id);assert.equal(b.checkpointHash,a.checkpointHash);assert.equal(b.replayed,true);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM audit_checkpoints').get().n,1);}finally{x.close();}
});

test('invalid or empty audit chains cannot be checkpointed',async()=>{
  const x=fixture();try{
    await assert.rejects(()=>create(x.svc,'empty','e'),/AUDIT_CHECKPOINT_EMPTY/);
    audit(x.store,'ta');x.store.db.exec('DROP TRIGGER audits_append_only_update');
    const row=x.store.db.prepare("SELECT seq,data_json FROM audits WHERE tenant_id='ta' ORDER BY seq LIMIT 1").get(),item=JSON.parse(row.data_json);item.outcome='FAILED';x.store.db.prepare('UPDATE audits SET data_json=? WHERE seq=?').run(JSON.stringify(item),row.seq);
    await assert.rejects(()=>create(x.svc,'ta','bad'),/AUDIT_CHAIN_INVALID/);
  }finally{x.close();}
});

test('latest checkpoint verifies an extended valid chain and external anchor',async()=>{
  const x=fixture();try{audit(x.store,'ta',2);const cp=await create(x.svc);x.store.audit({tenantId:'ta',traceId:'later',actorId:'u1',action:'AFTER',objectId:'o3',outcome:'SUCCESS'});const result=await x.svc.verifyLatest({tenantId:'ta'});assert.equal(result.status,'EXTENDED');assert.equal(result.checkpointId,cp.id);assert.equal(result.anchorVerified,true);assert.ok(result.auditCount>result.checkpointAuditCount);}finally{x.close();}
});

test('valid shorter restored ledger is detected as rollback',async()=>{
  const x=fixture();try{
    audit(x.store,'ta',3);const cp=await create(x.svc);assert.equal(cp.auditCount,3);
    x.store.db.exec('DROP TRIGGER audits_append_only_delete');
    x.store.db.prepare("DELETE FROM audits WHERE tenant_id='ta' AND seq>(SELECT MIN(seq) FROM audits WHERE tenant_id='ta')").run();
    assert.equal(x.store.verifyAuditChain('ta'),true);
    const result=await x.svc.verifyLatest({tenantId:'ta'});assert.equal(result.status,'ROLLBACK');assert.equal(result.anchorVerified,true);
  }finally{x.close();}
});

test('different valid history at checkpoint position is detected as fork',async()=>{
  const x=fixture();try{
    audit(x.store,'ta',2);const cp=await create(x.svc);assert.equal(cp.auditCount,2);
    x.store.db.exec('DROP TRIGGER audits_append_only_delete');x.store.db.prepare("DELETE FROM audits WHERE tenant_id='ta'").run();
    x.store.audit({tenantId:'ta',traceId:'fork1',actorId:'u2',action:'OTHER_A',objectId:'x',outcome:'SUCCESS'});
    x.store.audit({tenantId:'ta',traceId:'fork2',actorId:'u2',action:'OTHER_B',objectId:'y',outcome:'SUCCESS'});
    x.store.audit({tenantId:'ta',traceId:'fork3',actorId:'u2',action:'OTHER_C',objectId:'z',outcome:'SUCCESS'});
    assert.equal(x.store.verifyAuditChain('ta'),true);
    const result=await x.svc.verifyLatest({tenantId:'ta'});assert.equal(result.status,'FORKED');assert.equal(result.anchorVerified,true);
  }finally{x.close();}
});

test('external anchor verification failure overrides apparently valid local chain',async()=>{
  const store=new PlatformStore(':memory:'),sink=new MemoryAuditAnchor(),badVerifier={async verify(){return false;}};
  const svc=new AuditCheckpointService({store,anchorSink:sink,anchorVerifier:badVerifier,requireAnchor:true});
  try{audit(store);await create(svc);const result=await svc.verifyLatest({tenantId:'ta'});assert.equal(result.status,'ANCHOR_INVALID');assert.equal(result.anchorVerified,false);}finally{store.close();}
});

test('production-style required anchor cannot be configured without anchor sink',()=>{
  const store=new PlatformStore(':memory:');try{assert.throws(()=>new AuditCheckpointService({store,requireAnchor:true}),/AUDIT_CHECKPOINT_ANCHOR_REQUIRED/);}finally{store.close();}
});

test('unsafe anchor response is rejected without persisting checkpoint',async()=>{
  const store=new PlatformStore(':memory:'),sink={async anchor(){return {anchorRef:'bad anchor with spaces'};}};const svc=new AuditCheckpointService({store,anchorSink:sink,requireAnchor:true});
  try{audit(store);await assert.rejects(()=>create(svc),/AUDIT_CHECKPOINT_ANCHOR_INVALID/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM audit_checkpoints').get().n,0);}finally{store.close();}
});

test('anchor sink receives bounded checkpoint descriptor rather than audit contents',async()=>{
  const store=new PlatformStore(':memory:');let received;const sink={async anchor(value){received=value;return {anchorRef:'kms://anchor/v1'};}};const svc=new AuditCheckpointService({store,anchorSink:sink,requireAnchor:true});
  try{store.audit({tenantId:'ta',traceId:'private-trace',actorId:'u1',action:'SENSITIVE_ACTION',objectId:'secret-object',outcome:'SUCCESS',reason:'private-reason'});await create(svc);assert.deepEqual(Object.keys(received).sort(),['auditCount','checkpointHash','createdAt','headHash','tenantId','version'].sort());const text=JSON.stringify(received);for(const secret of ['SENSITIVE_ACTION','secret-object','private-reason','private-trace'])assert.equal(text.includes(secret),false);}finally{store.close();}
});

test('checkpoint lookup and verification are tenant isolated',async()=>{
  const x=fixture();try{audit(x.store,'ta');audit(x.store,'tb');const a=await create(x.svc,'ta','a'),b=await create(x.svc,'tb','b');assert.equal(x.store.getAuditCheckpoint('tb',a.id),null);assert.equal((await x.svc.verifyLatest({tenantId:'ta'})).checkpointId,a.id);assert.equal((await x.svc.verifyLatest({tenantId:'tb'})).checkpointId,b.id);}finally{x.close();}
});

test('readiness probe exposes only bounded integrity state and fails closed',async()=>{
  const x=fixture();try{
    const probe=createAuditCheckpointReadinessProbe({service:x.svc,tenantId:'ta'});
    assert.deepEqual(await probe(),{ok:false,code:'AUDIT_CHECKPOINT_MISSING'});
    audit(x.store,'ta',2);await create(x.svc);assert.deepEqual(await probe(),{ok:true,code:'AUDIT_CHECKPOINT_CURRENT'});
    x.store.db.exec('DROP TRIGGER audits_append_only_delete');x.store.db.prepare("DELETE FROM audits WHERE tenant_id='ta' AND seq>(SELECT MIN(seq) FROM audits WHERE tenant_id='ta')").run();
    assert.deepEqual(await probe(),{ok:false,code:'AUDIT_ROLLBACK_DETECTED'});
  }finally{x.close();}
});

