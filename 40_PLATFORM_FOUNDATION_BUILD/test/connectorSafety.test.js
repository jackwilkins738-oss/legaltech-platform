import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegrationRegistry} from '../src/integrationRegistry.js';
import {MockGraphHarness} from '../src/graphHarness.js';
import {ProclaimValidationHarness} from '../src/proclaimValidation.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {PlatformStore} from '../src/store.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';

function fixture(options = {}) {
  const registry = new IntegrationRegistry();
  const graph = new MockGraphHarness({registry, tenantId: 'tenant-a', ...options});
  graph.configure({mailboxes: ['ops@example.invalid']});
  const sub = graph.createMailboxSubscription('ops@example.invalid');
  return {registry, graph, sub};
}
const input = sub => ({subscriptionId: sub.id, notificationId: 'notification-1', resourceId: 'message-1'});
const code = value => error => error.code === value;

test('unapproved mailboxes and reader-disabled connectors cannot subscribe or set checkpoints', () => {
  const {graph} = fixture();
  assert.throws(() => graph.createMailboxSubscription('unapproved@example.invalid'), code('NOT_FOUND'));
  assert.throws(() => graph.setDelta('unapproved@example.invalid', 'delta'), code('NOT_FOUND'));
  graph.configure({mailboxes: ['ops@example.invalid'], reader: false});
  assert.throws(() => graph.createMailboxSubscription('ops@example.invalid'), code('NOT_FOUND'));
  assert.equal(graph.snapshot().subscriptions[0].status, 'OUT_OF_SCOPE');
  assert.equal(graph.healthCheck().state, 'DEGRADED');
});

test('rejected client state cannot poison accepted notification deduplication', () => {
  const {graph, sub} = fixture();
  const bad = graph.receiveNotification({...input(sub), clientStateValid: false});
  const good = graph.receiveNotification(input(sub));
  assert.equal(bad.status, 'REJECTED_CLIENT_STATE');
  assert.equal(good.status, 'ACCEPTED');
  assert.equal(good.duplicate, false);
  assert.notEqual(good.id, bad.id);
  assert.equal(graph.receiveNotification(input(sub)).id, good.id);
});

test('invalid client state cannot masquerade as an accepted duplicate or be retried', () => {
  const {graph, sub} = fixture();
  const good = graph.receiveNotification(input(sub));
  const bad = graph.receiveNotification({...input(sub), clientStateValid: false});
  assert.equal(bad.status, 'REJECTED_CLIENT_STATE');
  assert.equal(bad.duplicate, false);
  assert.equal(graph.snapshot().deliveries.find(x => x.id === good.id).duplicateCount, 0);
  assert.throws(() => graph.failDelivery(bad.id), code('INVALID_INTEGRATION_STATE'));
  assert.throws(() => graph.retryDelivery(bad.id), code('INVALID_INTEGRATION_STATE'));
});

test('successive same-resource updates without synthetic identity are not dropped', () => {
  const {graph, sub} = fixture();
  const one = graph.receiveNotification({subscriptionId: sub.id, resourceId: 'message-1'});
  const two = graph.receiveNotification({subscriptionId: sub.id, resourceId: 'message-1'});
  assert.equal(two.duplicate, false);
  assert.notEqual(one.id, two.id);
});

test('notification fingerprints distinguish ambiguous delimiters and different resources', () => {
  const {graph, sub} = fixture();
  const one = graph.receiveNotification({...input(sub), notificationId: 'a|b', resourceId: 'c'});
  const two = graph.receiveNotification({...input(sub), notificationId: 'a', resourceId: 'b|c'});
  assert.notEqual(one.fingerprint, two.fingerprint);
  assert.equal(graph.receiveNotification({...input(sub), resourceId: 'message-2'}).duplicate, false);
});

test('retry state transitions are bounded and recovery preserves lifetime attempts', () => {
  const {graph, sub} = fixture({maxDeliveryAttempts: 2});
  const item = graph.receiveNotification(input(sub));
  graph.failDelivery(item.id);
  assert.equal(graph.healthCheck().state, 'DEGRADED');
  assert.throws(() => graph.failDelivery(item.id), code('INVALID_INTEGRATION_STATE'));
  graph.retryDelivery(item.id);
  assert.equal(graph.failDelivery(item.id).status, 'DEAD_LETTER');
  const recovered = graph.retryDelivery(item.id);
  assert.equal(recovered.attempts, 0);
  assert.equal(recovered.totalAttempts, 2);
  assert.equal(recovered.recoveryCount, 1);
  assert.equal(graph.failDelivery(item.id).status, 'RETRY_SCHEDULED');
  assert.equal(graph.snapshot().deliveries[0].totalAttempts, 3);
});

test('expired subscriptions reject deliveries and retry until renewed', () => {
  let clock = Date.parse('2026-10-07T10:00:00Z');
  const {graph, sub} = fixture({now: () => clock});
  const item = graph.receiveNotification(input(sub)); graph.failDelivery(item.id);
  clock += 56 * 60 * 1000;
  assert.equal(graph.snapshot().subscriptions[0].status, 'EXPIRED');
  assert.equal(graph.healthCheck().subscriptions, 0);
  assert.throws(() => graph.receiveNotification(input(sub)), code('INVALID_INTEGRATION_STATE'));
  assert.throws(() => graph.retryDelivery(item.id), code('INVALID_INTEGRATION_STATE'));
  graph.renewSubscription(sub.id);
  assert.equal(graph.retryDelivery(item.id).status, 'ACCEPTED');
});

for (const status of ['MISSED', 'REMOVED', 'AUTHORIZATION_REQUIRED']) {
  test(`${status} subscriptions cannot accept or retry deliveries`, () => {
    const {graph, sub} = fixture();
    const item = graph.receiveNotification(input(sub)); graph.failDelivery(item.id);
    graph.lifecycle(sub.id, status);
    assert.throws(() => graph.receiveNotification(input(sub)), code('INVALID_INTEGRATION_STATE'));
    assert.throws(() => graph.retryDelivery(item.id), code('INVALID_INTEGRATION_STATE'));
    if (status !== 'MISSED') {
      assert.throws(() => graph.renewSubscription(sub.id), code('INVALID_INTEGRATION_STATE'));
      assert.throws(() => graph.lifecycle(sub.id, 'ACTIVE'), code('INVALID_INTEGRATION_STATE'));
      assert.throws(() => graph.lifecycle(sub.id, 'MISSED'), code('INVALID_INTEGRATION_STATE'));
    }
  });
}

test('mailbox revocation prevents operations on already-created subscriptions', () => {
  const {graph, sub} = fixture();
  graph.configure({mailboxes: ['replacement@example.invalid']});
  assert.throws(() => graph.receiveNotification(input(sub)), code('NOT_FOUND'));
  assert.throws(() => graph.renewSubscription(sub.id), code('NOT_FOUND'));
});

test('malformed connector inputs fail safely without changing delivery state', () => {
  const {graph, sub} = fixture();
  for (const change of [{notificationId: []}, {notificationId: ''}, {resourceId: {}}, {changeType: 'bogus'}, {clientStateValid: 'false'}]) {
    assert.throws(() => graph.receiveNotification({...input(sub), ...change}), code('INVALID_REQUEST'));
  }
  assert.throws(() => graph.lifecycle(sub.id, 'BOGUS'), code('INVALID_REQUEST'));
  assert.throws(() => graph.setDelta('ops@example.invalid', {}), code('INVALID_REQUEST'));
  assert.throws(() => graph.renewSubscription('sub_missing'), code('NOT_FOUND'));
  assert.equal(graph.snapshot().deliveries.length, 0);
  for (const maxDeliveryAttempts of [0, -1, 1.5, '3', 101]) assert.throws(() => fixture({maxDeliveryAttempts}), code('INVALID_REQUEST'));
});

test('caller-supplied failure content is excluded from snapshots', () => {
  const {graph, sub} = fixture();
  const item = graph.receiveNotification(input(sub));
  graph.failDelivery(item.id, 'private failure text');
  assert.doesNotMatch(JSON.stringify(graph.snapshot()), /private failure text/);
});

async function withApi(run) {
  const {registry, graph, sub} = fixture();
  const store = new PlatformStore();
  const proclaim = new ProclaimValidationHarness({registry, adapter: new MockProclaimAdapter(), tenantId: 'tenant-a'});
  proclaim.configure();
  const integrations = {registry, graph, proclaim, summary: tenantId => ({items: registry.list(tenantId), graph: graph.healthCheck()})};
  const sessions = [
    {token: 'owner', actorId: 'operator-a', tenantId: 'tenant-a', capabilities: ['integration:read', 'integration:manage']},
    {token: 'foreign', actorId: 'operator-b', tenantId: 'tenant-b', capabilities: ['integration:read', 'integration:manage']},
    {token: 'reader', actorId: 'reader-a', tenantId: 'tenant-a', capabilities: ['integration:read']},
  ];
  const server = createApiServer({platform: {store}, integrations, authProvider: new StaticAuthProvider(sessions)});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, {token = 'owner', method = 'GET', body} = {}) => fetch(`${base}/api/v1/integrations${route}`, {
    method, headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-trace-id': 'trace-connector-safety'}, ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
  try { await run({request, graph, sub, store}); }
  finally { await new Promise(resolve => server.close(resolve)); store.close(); }
}

test('all integration endpoints hide bound harness state from other tenants', async () => {
  await withApi(async ({request, graph, sub, store}) => {
    const item = graph.receiveNotification(input(sub));
    const routes = [
      ['', 'GET'], ['/graph', 'GET'],
      ['/graph/subscriptions', 'POST', {mailboxId: 'ops@example.invalid'}],
      [`/graph/subscriptions/${sub.id}/renew`, 'POST'],
      [`/graph/subscriptions/${sub.id}/lifecycle`, 'POST', {status: 'REMOVED'}],
      ['/graph/delta-checkpoints', 'POST', {mailboxId: 'ops@example.invalid', deltaToken: 'private-checkpoint'}],
      ['/graph/webhooks/simulate', 'POST', input(sub)],
      [`/graph/deliveries/${item.id}/fail`, 'POST', {}],
      [`/graph/deliveries/${item.id}/retry`, 'POST'],
      ['/proclaim/validate', 'POST', {}],
    ];
    const before = graph.snapshot();
    for (const [route, method, body] of routes) {
      const response = await request(route, {token: 'foreign', method, body});
      assert.equal(response.status, 404, route);
      const denied=await response.json(); assert.equal(denied.code,'NOT_FOUND'); assert.equal(denied.message,'resource unavailable'); assert.match(denied.trace_id,/^trc_[0-9a-f-]{36}$/); assert.equal(denied.trace_id,response.headers.get('x-trace-id'));
    }
    const after = graph.snapshot(); delete before.health.lastCheck; delete after.health.lastCheck;
    assert.deepEqual(after, before);
    assert.equal(store.listAudits('tenant-a').length, 0);
  });
});

test('renew and retry enforce capability and supplied tenant on every mutation', async () => {
  await withApi(async ({request, graph, sub}) => {
    const item = graph.receiveNotification(input(sub)); graph.failDelivery(item.id);
    for (const route of [`/graph/subscriptions/${sub.id}/renew`, `/graph/deliveries/${item.id}/retry`]) {
      assert.equal((await request(route, {token: 'reader', method: 'POST'})).status, 404);
      assert.equal((await request(route, {method: 'POST', body: {tenantId: 'tenant-b'}})).status, 404);
    }
    assert.equal(graph.snapshot().deliveries[0].status, 'RETRY_SCHEDULED');
  });
});

test('malformed JSON shapes and integration types return stable 400 responses', async () => {
  await withApi(async ({request, sub}) => {
    for (const body of [null, [], 1, 'text']) {
      const response = await request('/graph/subscriptions', {method: 'POST', body});
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'INVALID_REQUEST');
    }
    for (const body of [{...input(sub), clientStateValid: 'false'}, {...input(sub), clientStateValid: null}, {mailboxId: {}}, {mailboxId: 'ops@example.invalid', folder: []}]) {
      assert.equal((await request(body.subscriptionId ? '/graph/webhooks/simulate' : '/graph/subscriptions', {method: 'POST', body})).status, 400);
    }
    assert.equal((await request('/graph/subscriptions/sub_missing/renew', {method: 'POST'})).status, 404);
  });
});

test('every connector mutation has actor and trace audit with minimized contents', async () => {
  await withApi(async ({request, graph, sub, store}) => {
    const item = graph.receiveNotification(input(sub)); graph.failDelivery(item.id);
    const operations = [
      ['/graph/subscriptions', {mailboxId: 'ops@example.invalid'}, 'GRAPH_SUBSCRIPTION_CREATE'],
      [`/graph/subscriptions/${sub.id}/renew`, {}, 'GRAPH_SUBSCRIPTION_RENEW'],
      [`/graph/subscriptions/${sub.id}/lifecycle`, {status: 'ACTIVE'}, 'GRAPH_SUBSCRIPTION_LIFECYCLE'],
      ['/graph/delta-checkpoints', {mailboxId: 'ops@example.invalid', deltaToken: 'private-checkpoint'}, 'GRAPH_DELTA_CHECKPOINT_SET'],
      ['/graph/webhooks/simulate', {...input(sub), notificationId: 'notification-2'}, 'GRAPH_WEBHOOK_SIMULATE'],
      [`/graph/deliveries/${item.id}/retry`, {}, 'GRAPH_DELIVERY_RETRY'],
      [`/graph/deliveries/${item.id}/fail`, {error: 'private failure text'}, 'GRAPH_DELIVERY_FAIL'],
      ['/proclaim/validate', {}, 'PROCLAIM_VALIDATION_RUN'],
    ];
    for (const [route, body, action] of operations) {
      const response = await request(route, {method: 'POST', body});
      assert.ok(response.ok, `${action}: ${response.status}`);
      const entries = store.listAudits('tenant-a').filter(x => x.action === action);
      assert.deepEqual(entries.map(x => x.outcome), ['ATTEMPT', 'SUCCESS']);
      const serverTrace=response.headers.get('x-trace-id'); assert.match(serverTrace,/^trc_[0-9a-f-]{36}$/); assert.ok(entries.every(x => x.actorId === 'operator-a' && x.traceId === serverTrace));
    }
    assert.equal(store.listAudits('tenant-b').length, 0);
    assert.doesNotMatch(JSON.stringify(store.listAudits('tenant-a')), /private-checkpoint|private failure text|ops@example/);
  });
});

test('audit unavailability fails closed and denied recovery records failure', async () => {
  await withApi(async ({request, graph, sub, store}) => {
    graph.lifecycle(sub.id, 'REMOVED');
    assert.equal((await request(`/graph/subscriptions/${sub.id}/renew`, {method: 'POST'})).status, 409);
    assert.equal(store.listAudits('tenant-a').at(-1).outcome, 'FAILED');
    const original = store.audit; store.audit = () => { throw new Error('audit unavailable'); };
    const before = graph.snapshot().subscriptions.length;
    assert.equal((await request('/graph/subscriptions', {method: 'POST', body: {mailboxId: 'ops@example.invalid'}})).status, 500);
    assert.equal(graph.snapshot().subscriptions.length, before);
    store.audit = original;
  });
});
