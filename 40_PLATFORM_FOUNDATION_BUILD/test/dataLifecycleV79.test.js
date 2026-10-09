import test from 'node:test';
import assert from 'node:assert/strict';
import {DataLifecycleRegistry} from '../src/dataLifecycle.js';

const DAY=86_400_000;
function fixture(){let now=Date.parse('2026-10-09T12:00:00.000Z');const lifecycle=new DataLifecycleRegistry({now:()=>now});return {lifecycle,get now(){return now},set now(v){now=v}};}
function published(x,{days=30,key='MATTER_CONTENT',resourceClass='MATTER_CONTENT'}={}){const draft=x.lifecycle.createPolicyDraft({tenantId:'tenant-a',policyKey:key,resourceClass,retentionDays:days,actorId:'admin-a'});return x.lifecycle.publishPolicy({tenantId:'tenant-a',policyKey:key,version:draft.version,actorId:'admin-b'});}
function plan(x,{createdDaysAgo=31,actorId='operator-a',idem='idem-12345678',matterId='matter-1',resourceRef='resource-1'}={}){return x.lifecycle.planDisposition({tenantId:'tenant-a',policyKey:'MATTER_CONTENT',resourceClass:'MATTER_CONTENT',resourceRef,matterId,createdAt:new Date(x.now-createdDaysAgo*DAY).toISOString(),actorId,idempotencyKey:idem});}

test('V79 no retention period exists until an explicit policy is published',()=>{
  const x=fixture();
  assert.throws(()=>plan(x),/LIFECYCLE_POLICY_UNAVAILABLE/);
  const draft=x.lifecycle.createPolicyDraft({tenantId:'tenant-a',policyKey:'MATTER_CONTENT',resourceClass:'MATTER_CONTENT',retentionDays:30,actorId:'admin-a'});
  assert.equal(draft.status,'DRAFT'); assert.throws(()=>plan(x),/LIFECYCLE_POLICY_UNAVAILABLE/);
});

test('V79 retention eligibility is calculated from the pinned published policy',()=>{
  const x=fixture(); const policy=published(x,{days:30});
  assert.throws(()=>plan(x,{createdDaysAgo:29}),/LIFECYCLE_NOT_ELIGIBLE/);
  const intent=plan(x,{createdDaysAgo:30});
  assert.equal(intent.policyVersion,policy.version); assert.equal(intent.policyHash,policy.definitionHash); assert.equal(intent.status,'PENDING_APPROVAL');
});

test('V79 matter legal hold blocks every linked resource disposition',()=>{
  const x=fixture();published(x);
  x.lifecycle.placeHold({tenantId:'tenant-a',scope:{kind:'MATTER',matterId:'matter-1'},reasonCode:'LITIGATION_HOLD',actorId:'legal-a'});
  assert.throws(()=>plan(x),/LEGAL_HOLD_ACTIVE/);
  assert.doesNotThrow(()=>plan(x,{matterId:'matter-2',resourceRef:'resource-2',idem:'idem-other-1234'}));
});

test('V79 resource legal hold is narrow and fail closed for that resource',()=>{
  const x=fixture();published(x);
  x.lifecycle.placeHold({tenantId:'tenant-a',scope:{kind:'RESOURCE',resourceClass:'MATTER_CONTENT',resourceRef:'resource-1'},reasonCode:'REGULATORY_HOLD',actorId:'legal-a'});
  assert.throws(()=>plan(x),/LEGAL_HOLD_ACTIVE/);
  assert.doesNotThrow(()=>plan(x,{resourceRef:'resource-2',idem:'idem-other-5678'}));
});

test('V79 a hold placed after planning blocks later approval',()=>{
  const x=fixture();published(x);const intent=plan(x);
  x.lifecycle.placeHold({tenantId:'tenant-a',scope:{kind:'MATTER',matterId:'matter-1'},reasonCode:'NEW_DISPUTE',actorId:'legal-a'});
  assert.throws(()=>x.lifecycle.approveDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'approver-b'}),/LEGAL_HOLD_ACTIVE/);
});

test('V79 disposition approval requires a second actor',()=>{
  const x=fixture();published(x);const intent=plan(x,{actorId:'operator-a'});
  assert.throws(()=>x.lifecycle.approveDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'operator-a'}),/LIFECYCLE_DUAL_CONTROL_REQUIRED/);
  const approved=x.lifecycle.approveDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'approver-b'});
  assert.equal(approved.status,'APPROVED');assert.equal(approved.approvedBy,'approver-b');
});

test('V79 a newer published policy invalidates an older pending disposition',()=>{
  const x=fixture();published(x,{days:30});const intent=plan(x);
  const draft=x.lifecycle.createPolicyDraft({tenantId:'tenant-a',policyKey:'MATTER_CONTENT',resourceClass:'MATTER_CONTENT',retentionDays:60,actorId:'admin-a'});
  x.lifecycle.publishPolicy({tenantId:'tenant-a',policyKey:'MATTER_CONTENT',version:draft.version,actorId:'admin-b'});
  assert.throws(()=>x.lifecycle.approveDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'approver-b'}),/LIFECYCLE_POLICY_SUPERSEDED/);
});

test('V79 disposition planning is idempotent and changed replay fails closed',()=>{
  const x=fixture();published(x);const first=plan(x);const replay=plan(x);assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);
  assert.throws(()=>plan(x,{resourceRef:'resource-2'}),/LIFECYCLE_IDEMPOTENCY_CONFLICT/);
});

test('V79 hold release is explicit and recorded before new disposition can proceed',()=>{
  const x=fixture();published(x);const hold=x.lifecycle.placeHold({tenantId:'tenant-a',scope:{kind:'MATTER',matterId:'matter-1'},reasonCode:'LITIGATION_HOLD',actorId:'legal-a'});
  assert.throws(()=>plan(x),/LEGAL_HOLD_ACTIVE/);
  const released=x.lifecycle.releaseHold({tenantId:'tenant-a',holdId:hold.id,reasonCode:'MATTER_RESOLVED',actorId:'legal-b'});assert.equal(released.status,'RELEASED');
  assert.doesNotThrow(()=>plan(x));
  assert.deepEqual(x.lifecycle.listEvents('tenant-a').map(x=>x.type).filter(x=>x.startsWith('LEGAL_HOLD_')),['LEGAL_HOLD_PLACED','LEGAL_HOLD_RELEASED']);
});

test('V79 policy inputs and legal-hold reasons are bounded codes rather than free text',()=>{
  const x=fixture();
  assert.throws(()=>x.lifecycle.createPolicyDraft({tenantId:'tenant-a',policyKey:'bad policy',resourceClass:'MATTER_CONTENT',retentionDays:30,actorId:'admin-a'}),/LIFECYCLE_POLICY_KEY_INVALID/);
  assert.throws(()=>x.lifecycle.createPolicyDraft({tenantId:'tenant-a',policyKey:'MATTER_CONTENT',resourceClass:'MATTER_CONTENT',retentionDays:0,actorId:'admin-a'}),/LIFECYCLE_RETENTION_DAYS_INVALID/);
  assert.throws(()=>x.lifecycle.placeHold({tenantId:'tenant-a',scope:{kind:'MATTER',matterId:'matter-1'},reasonCode:'client says do not delete this please',actorId:'legal-a'}),/LEGAL_HOLD_REASON_INVALID/);
});

test('V79 cancelled disposition cannot later be approved',()=>{
  const x=fixture();published(x);const intent=plan(x);const cancelled=x.lifecycle.cancelDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'operator-c',reasonCode:'REVIEW_REQUIRED'});assert.equal(cancelled.status,'CANCELLED');
  assert.throws(()=>x.lifecycle.approveDisposition({tenantId:'tenant-a',intentId:intent.id,actorId:'approver-b'}),/LIFECYCLE_INTENT_CLOSED/);
});

test('V79 registry deliberately exposes no automatic delete or execute method',()=>{
  const x=fixture(); assert.equal(typeof x.lifecycle.executeDisposition,'undefined'); assert.equal(typeof x.lifecycle.deleteResource,'undefined');
});
