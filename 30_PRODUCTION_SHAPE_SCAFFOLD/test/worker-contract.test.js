import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRetryDelayMs, failureTransition, assertJobTenant } from '../src/workerPolicy.js';

test('retry delay grows exponentially and caps', () => {
  assert.equal(nextRetryDelayMs(1),1000);
  assert.equal(nextRetryDelayMs(3),4000);
  assert.equal(nextRetryDelayMs(20),300000);
});

test('retryable job moves to retry wait before maximum', () => {
  const j={attempts:0,maxAttempts:3,tenantId:'t-a'};
  const n=failureTransition(j,{retryable:true,errorCode:'TIMEOUT',now:0});
  assert.equal(n.status,'RETRY_WAIT');
  assert.equal(n.attempts,1);
});

test('nonretryable job goes dead letter immediately', () => {
  const j={attempts:0,maxAttempts:3,tenantId:'t-a'};
  assert.equal(failureTransition(j,{retryable:false,errorCode:'AUTH'}).status,'DEAD_LETTER');
});

test('worker cannot substitute tenant context', () => {
  assert.throws(()=>assertJobTenant({tenantId:'t-a'},'t-b'),/TENANT_MISMATCH/);
});
