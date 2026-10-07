import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Platform} from '../src/platform.js';
import {PlatformStore} from '../src/store.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {KnownWriteFailure} from '../src/adapters.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';
import {writebackScope} from '../src/writeback.js';

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
class External {
  constructor(){this.writes=0;this.reads=0;this.history=[];}
  async createHistory(input){this.writes++;const row={id:`external-${this.writes}`,...structuredClone(input)};this.history.push(row);return {externalWriteId:row.id};}
  async getHistory(input){this.reads++;return structuredClone(this.history.filter(row=>row.tenantId===input.tenantId&&row.externalMatterId===input.externalMatterId));}
}
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-claims-'));
  const db=path.join(dir,'state.sqlite'),adapter=new External(),stores=[];
  const open=()=>{
    const store=new PlatformStore(db,{matters:[{id:'ma',tenantId:'ta',externalId:'PA',externalRefs:['CLM-10001']}]});stores.push(store);
    const platform=new Platform({store,objectStorage:new LocalObjectStorage(path.join(dir,'objects')),aiGateway:new DeterministicAIGateway(),proclaim:adapter});
    return {store,platform};
  };
  const x={...open(),adapter,open};
  x.prepare=async()=>{
    const event=x.platform.ingest({tenantId:'ta',input:{subject:'CLM-10001'},idempotencyKey:x.store.uid('ing')});
    await x.platform.processNext();const key=x.store.uid('approve');
    return {...x.platform.approve({tenantId:'ta',eventId:event.eventId,actorId:'reviewer',idempotencyKey:key}),key};
  };
  x.command=w=>x.store.getIdempotent(writebackScope('ta',w.key));
  x.process=w=>x.platform.processWritebackNext({tenantId:'ta',eventId:w.eventId});
  x.expire=id=>x.store.db.prepare("UPDATE jobs SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
  x.recover=(w,key='recover-key')=>x.platform.requestWritebackReconciliation({tenantId:'ta',eventId:w.eventId,actorId:'operator',idempotencyKey:key});
  x.audit=()=>x.store.listAudits('ta');
  x.holdReads=()=>{
    const gates=[deferred(),deferred(),deferred()],started=[deferred(),deferred(),deferred()];
    adapter.getHistory=async()=>{const index=adapter.reads++;started[index].resolve();return gates[index].promise;};
    return {gates,started};
  };
  x.close=()=>{for(const store of stores)store.close();fs.rmSync(dir,{recursive:true,force:true});};
  return x;
}

for(const outcome of ['failure','empty','malformed','positive']) {
  test(`reclaimed attempt ignores late ${outcome} read without changing its replacement`,async()=>{
    const x=fixture();try {
      const w=await x.prepare(),r=x.holdReads();const old=x.process(w);await r.started[0].promise;
      x.expire(w.jobId);const fresh=x.process(w);await r.started[1].promise;
      const before=x.command(w),job=x.store.getJob(w.jobId),audits=x.audit();
      if(outcome==='failure')r.gates[0].reject(Error('synthetic-private-provider-text'));
      else r.gates[0].resolve(outcome==='empty'?[]:outcome==='malformed'?{}:x.adapter.history);
      assert.equal((await old).status,'SUPERSEDED');
      assert.deepEqual(x.command(w),before);assert.deepEqual(x.store.getJob(w.jobId),job);assert.deepEqual(x.audit(),audits);
      assert.equal(job.status,'RUNNING');assert.equal(job.attempts,2);
      r.gates[1].resolve(x.adapter.history);assert.equal((await fresh).result.verified,true);
      assert.equal(x.adapter.writes,1);assert.equal(x.adapter.reads,2);
      assert.equal(x.store.getJob(w.jobId).status,'DONE');
    } finally {x.close();}
  });
}

test('same claimed attempt remains fenced across separate SQLite connections',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),r=x.holdReads();const old=x.process(w);await r.started[0].promise;
    const second=x.open();x.expire(w.jobId);
    const fresh=second.platform.processWritebackNext({tenantId:'ta',eventId:w.eventId});await r.started[1].promise;
    r.gates[0].reject(Error('retired worker failure'));assert.equal((await old).status,'SUPERSEDED');
    assert.equal(second.store.getJob(w.jobId).status,'RUNNING');
    r.gates[1].resolve(x.adapter.history);assert.equal((await fresh).result.verified,true);
  } finally {x.close();}
});

for(const failure of [false,true]) {
  test(`reclaimed external write ignores its late ${failure?'known failure':'receipt'} and never resends`,async()=>{
    const x=fixture();try {
      const gate=deferred(),started=deferred(),read=deferred(),readStarted=deferred();
      const create=x.adapter.createHistory.bind(x.adapter);
      x.adapter.createHistory=async input=>{
        const receipt=failure?(x.adapter.writes++,null):await create(input);
        started.resolve();await gate.promise;
        if(failure)throw new KnownWriteFailure({retryable:true,code:'RATE_LIMITED'});
        return receipt;
      };
      x.adapter.getHistory=async()=>{x.adapter.reads++;readStarted.resolve();return read.promise;};
      const w=await x.prepare(),old=x.process(w);await started.promise;
      x.expire(w.jobId);const fresh=x.process(w);await readStarted.promise;
      const before=x.command(w);gate.resolve();assert.equal((await old).status,'SUPERSEDED');
      assert.deepEqual(x.command(w),before);assert.equal(x.store.getJob(w.jobId).status,'RUNNING');
      read.resolve(x.adapter.history);await fresh;
      if(failure){for(let i=0;i<4;i++)await x.process(w);assert.equal(x.command(w).state,'OUTCOME_UNKNOWN');}
      else assert.equal(x.command(w).state,'RECONCILED');
      assert.equal(x.adapter.writes,1);
    } finally {x.close();}
  });
}

for(const outcome of ['failure','empty','malformed']) {
  test(`older recovery-cycle ${outcome} cannot exhaust the new cycle`,async()=>{
    const x=fixture();try {
      const w=await x.prepare(),r=x.holdReads(),old=x.process(w);await r.started[0].promise;
      const recovery=x.recover(w),before=x.command(w);
      if(outcome==='failure')r.gates[0].reject(Error('old cycle error'));else r.gates[0].resolve(outcome==='empty'?[]:{});
      assert.equal((await old).status,'SUPERSEDED');assert.deepEqual(x.command(w),before);
      assert.equal(x.command(w).reconciliationAttempts,0);assert.equal(x.command(w).totalReadAttempts,1);
      assert.equal(x.store.getJob(w.jobId).status,'DONE');assert.equal(x.store.getJob(recovery.jobId).status,'QUEUED');
      const fresh=x.process(w);await r.started[1].promise;r.gates[1].resolve(x.adapter.history);
      assert.equal((await fresh).result.verified,true);assert.equal(x.command(w).reconciliationAttempts,1);
    } finally {x.close();}
  });
}

test('valid read-back from an older cycle preserves proof and current counters',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),r=x.holdReads(),old=x.process(w);await r.started[0].promise;
    const recovery=x.recover(w);r.gates[0].resolve(x.adapter.history);
    assert.equal((await old).status,'SUPERSEDED');assert.equal(x.command(w).state,'RECONCILED');
    assert.equal(x.command(w).recoveryCount,1);assert.equal(x.command(w).reconciliationAttempts,0);
    assert.equal(x.command(w).totalReadAttempts,1);assert.equal(x.command(w).jobId,recovery.jobId);
    assert.equal((await x.process(w)).result.verified,true);assert.equal(x.adapter.reads,1);
    assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_WRITE_RECONCILED').length,1);
  } finally {x.close();}
});

test('conflicting late receipt cannot replace the current receipt or assert success',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),r=x.holdReads(),old=x.process(w);await r.started[0].promise;
    x.recover(w);const c=x.command(w);c.externalWriteId='different-current-receipt';x.store.setIdempotent(writebackScope('ta',w.key),c);
    r.gates[0].resolve(x.adapter.history);assert.equal((await old).status,'SUPERSEDED');
    assert.deepEqual(x.command(w),c);assert.notEqual(x.command(w).state,'RECONCILED');
  } finally {x.close();}
});

test('late receipt from an owned older cycle is retained without consuming the new budget',async()=>{
  const x=fixture();try {
    const gate=deferred(),started=deferred(),create=x.adapter.createHistory.bind(x.adapter);
    x.adapter.createHistory=async input=>{const receipt=await create(input);started.resolve();await gate.promise;return receipt;};
    const w=await x.prepare(),old=x.process(w);await started.promise;const recovery=x.recover(w);
    gate.resolve();assert.equal((await old).status,'SUPERSEDED');
    assert.equal(x.command(w).externalWriteId,'external-1');assert.equal(x.command(w).reconciliationAttempts,0);
    assert.equal(x.command(w).recoveryCount,1);assert.equal(x.command(w).jobId,recovery.jobId);
    assert.equal(x.adapter.reads,0);assert.equal(x.store.getEvent('ta',w.eventId).writeback.verified,false);
    assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_LATE_RECEIPT_CAPTURED').length,1);
    assert.equal((await x.process(w)).result.verified,true);assert.equal(x.adapter.writes,1);
  } finally {x.close();}
});

test('old-cycle known failure cannot reset current uncertainty or create a write retry',async()=>{
  const x=fixture();try {
    const gate=deferred(),started=deferred();
    x.adapter.createHistory=async()=>{x.adapter.writes++;started.resolve();await gate.promise;throw new KnownWriteFailure({retryable:true});};
    const w=await x.prepare(),old=x.process(w);await started.promise;x.recover(w);const before=x.command(w);
    gate.resolve();assert.equal((await old).status,'SUPERSEDED');assert.deepEqual(x.command(w),before);
    for(let i=0;i<4;i++)await x.process(w);assert.equal(x.adapter.writes,1);assert.equal(x.command(w).uncertain,true);
  } finally {x.close();}
});

test('legacy overlapping jobs share three reserved reads and one external write',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),r=x.holdReads(),job=x.store.getJob(w.jobId);
    for(let i=0;i<3;i++)x.store.enqueue({tenantId:'ta',type:'PROCLAIM_WRITEBACK',payload:job.payload,traceId:job.traceId});
    const pending=[];
    for(let i=0;i<3;i++){pending.push(x.process(w));await r.started[i].promise;}
    const exhausted=await x.process(w);assert.equal(exhausted.status,'FAILED');
    assert.equal(x.adapter.reads,3);assert.equal(x.command(w).reconciliationAttempts,3);assert.equal(x.command(w).totalReadAttempts,3);
    for(const gate of r.gates)gate.resolve(x.adapter.history);
    for(const result of await Promise.all(pending))assert.equal(result.result.verified,true);
    assert.equal(x.adapter.writes,1);assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_WRITE_RECONCILED').length,1);
  } finally {x.close();}
});

test('read-back completion and job completion roll back together on job-store failure',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),complete=x.store.completeClaimedJob.bind(x.store);let fail=true;
    x.store.completeClaimedJob=job=>{if(fail){fail=false;throw Error('synthetic-private-db-error');}return complete(job);};
    const result=await x.process(w);assert.equal(result.status,'FAILED');assert.equal(result.error,'WRITEBACK_INTERNAL_ERROR');
    assert.notEqual(x.command(w).state,'RECONCILED');assert.notEqual(x.store.getEvent('ta',w.eventId).status,'COMPLETED');
    assert.equal(x.store.getJob(w.jobId).status,'QUEUED');assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_WRITE_RECONCILED').length,0);
    assert.equal((await x.process(w)).result.verified,true);assert.equal(x.adapter.writes,1);assert.equal(x.adapter.reads,2);
  } finally {x.close();}
});

test('read-back audit failure cannot leave a completed event or job',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),audit=x.store.audit.bind(x.store);let fail=true;
    x.store.audit=entry=>{if(fail&&entry.action==='PROCLAIM_WRITE_RECONCILED'){fail=false;throw Error('audit unavailable');}return audit(entry);};
    assert.equal((await x.process(w)).status,'FAILED');assert.notEqual(x.command(w).state,'RECONCILED');
    assert.equal(x.store.getJob(w.jobId).status,'QUEUED');assert.equal((await x.process(w)).result.verified,true);
    assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_WRITE_RECONCILED').length,1);assert.equal(x.adapter.writes,1);
  } finally {x.close();}
});

test('no external read starts before its reservation commits',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),set=x.store.setIdempotent.bind(x.store);let fail=true;
    x.store.setIdempotent=(scope,value)=>{if(fail&&value.state==='RECONCILING'){fail=false;throw Error('read reservation failure');}return set(scope,value);};
    assert.equal((await x.process(w)).status,'FAILED');assert.equal(x.adapter.reads,0);assert.equal(x.command(w).totalReadAttempts,0);
    assert.equal((await x.process(w)).result.verified,true);assert.equal(x.adapter.reads,1);assert.equal(x.adapter.writes,1);
  } finally {x.close();}
});

test('conditional job updates reject stale claims and wrong tenant/type',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),first=x.store.claimNext('PROCLAIM_WRITEBACK','ta');
    for(const forged of [{...first,tenantId:'tb'},{...first,type:'PROCESS_INBOUND'},{...first,attempts:0}]){
      assert.equal(x.store.isCurrentClaim(forged),false);assert.equal(x.store.completeClaimedJob(forged),false);
      assert.equal(x.store.failClaimedJob(forged,'must-not-persist'),false);
    }
    x.expire(w.jobId);x.store.recoverExpiredWritebackJobs({tenantId:'ta'});const current=x.store.claimNext('PROCLAIM_WRITEBACK','ta');
    assert.equal(x.store.completeClaimedJob(first),false);assert.equal(x.store.failClaimedJob(first,'stale-error'),false);
    assert.equal(x.store.getJob(w.jobId).lastError,null);assert.equal(x.store.completeClaimedJob(current),true);
  } finally {x.close();}
});

test('a queued or terminal job is not a current running claim',async()=>{
  const x=fixture();try {
    const w=await x.prepare(),queued=x.store.getJob(w.jobId);
    assert.equal(x.store.completeClaimedJob(queued),false);assert.equal(x.store.failClaimedJob(queued,'queued-error'),false);
    const claimed=x.store.claimNext('PROCLAIM_WRITEBACK','ta');assert.equal(x.store.failClaimedJob(claimed,'safe-code',{retry:false}),true);
    assert.equal(x.store.isCurrentClaim(claimed),false);assert.equal(x.store.completeClaimedJob(claimed),false);
    assert.equal(x.store.getJob(w.jobId).status,'DEAD');
  } finally {x.close();}
});

test('authenticated HTTP drain reports superseded lease attempt without corrupting replacement',async()=>{
  const x=fixture();let server;try {
    const w=await x.prepare(),r=x.holdReads();
    server=createApiServer({platform:x.platform,devWorkers:true,authProvider:new StaticAuthProvider([{token:'worker',tenantId:'ta',actorId:'operator',capabilities:['dev:workers','inbound:read']}])});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const post=()=>fetch(`http://127.0.0.1:${server.address().port}/api/v1/dev/workers/drain-one`,{method:'POST',headers:{authorization:'Bearer worker','content-type':'application/json'},body:JSON.stringify({worker:'writeback',eventId:w.eventId})});
    const old=post();await r.started[0].promise;x.expire(w.jobId);const fresh=post();await r.started[1].promise;
    r.gates[0].reject(Error('synthetic-private-provider-text'));const response=await old;assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.result.status,'SUPERSEDED');assert.equal(body.result.eventId,w.eventId);
    assert.doesNotMatch(JSON.stringify(body),/private-provider/);assert.equal(x.store.getJob(w.jobId).status,'RUNNING');
    r.gates[1].resolve(x.adapter.history);assert.equal((await (await fresh).json()).result.result.verified,true);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));x.close();}
});

test('late receipt capture audit failure preserves newer intent and never repeats external write',async()=>{
  const x=fixture();try {
    const gate=deferred(),started=deferred(),create=x.adapter.createHistory.bind(x.adapter);
    x.adapter.createHistory=async input=>{const receipt=await create(input);started.resolve();await gate.promise;return receipt;};
    const w=await x.prepare(),old=x.process(w);await started.promise;x.recover(w);const before=x.command(w);
    const audit=x.store.audit.bind(x.store);x.store.audit=entry=>{if(entry.action==='PROCLAIM_LATE_RECEIPT_CAPTURED')throw Error('capture audit unavailable');return audit(entry);};
    gate.resolve();assert.equal((await old).status,'FAILED');assert.deepEqual(x.command(w),before);
    x.store.audit=audit;assert.equal((await x.process(w)).result.verified,true);assert.equal(x.adapter.writes,1);
    assert.equal(x.audit().filter(a=>a.action==='PROCLAIM_LATE_RECEIPT_CAPTURED').length,0);
  } finally {x.close();}
});
