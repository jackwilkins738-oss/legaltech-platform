import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {IdempotencyStore,AuditLog} from '../src/domain.js'; import {MockProclaimAdapter} from '../src/adapters.js'; import {processInbound} from '../src/pipeline.js';
const matters=JSON.parse(fs.readFileSync(new URL('../fixtures/matters.json',import.meta.url),'utf8'));
const emails=fs.readFileSync(new URL('../fixtures/emails.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
test('write is verified and replay does not duplicate',async()=>{
  const e=emails.find(x=>x.mode==='EXACT'); const idem=new IdempotencyStore(); const audit=new AuditLog(); const p=new MockProclaimAdapter(matters);
  const first=await processInbound({tenantId:'T1',email:e,matters,proclaim:p,idempotency:idem,audit}); assert.equal(first.status,'WRITTEN');
  const second=await processInbound({tenantId:'T1',email:e,matters,proclaim:p,idempotency:idem,audit}); assert.equal(second.status,'DUPLICATE');
  const matter=await p.getMatterByExternalId(first.matterId); assert.equal(matter.history.length,1);
});
test('ambiguous cases require explicit review',async()=>{
  const e=emails.find(x=>x.mode==='AMBIGUOUS'); const idem=new IdempotencyStore(); const audit=new AuditLog(); const p=new MockProclaimAdapter(matters);
  const r=await processInbound({tenantId:'T1',email:e,matters,proclaim:p,idempotency:idem,audit}); assert.equal(r.status,'REVIEW_REQUIRED');
});
