import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {appError} from './errors.js';
import {decodeInboundBody} from './inboundRequest.js';
import {requireCapability} from './auth.js';

const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
]);

function safeTraceId(req) {
  const supplied = req.headers['x-trace-id'];
  if (typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return `trc_${crypto.randomUUID()}`;
}

function send(res, status, payload, traceId) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-trace-id': traceId,
  });
  res.end(body);
}

function serveStatic(res, uiRoot, pathname) {
  if (!uiRoot || !STATIC_FILES.has(pathname)) return false;
  const [filename, contentType] = STATIC_FILES.get(pathname);
  const filePath = path.join(uiRoot, filename);
  if (!fs.existsSync(filePath)) return false;
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw appError('request body too large', {status: 413, code: 'BODY_TOO_LARGE'});
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw appError('invalid request', {code: 'INVALID_REQUEST'});
    return body;
  } catch (error) {
    if (error.code === 'INVALID_REQUEST') throw error;
    throw appError('invalid json', {status: 400, code: 'INVALID_JSON'});
  }
}

function idempotencyKey(req) {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw appError('valid Idempotency-Key required', {status: 400, code: 'IDEMPOTENCY_REQUIRED'});
  }
  return value;
}

function assertBodyTenant(body, session) {
  if (body.tenantId != null && body.tenantId !== session.tenantId) {
    throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
  }
}

export function createApiServer({platform, authProvider, devWorkers = false, uiRoot = null, integrations = null}) {
  async function integrationMutation(session, traceId, action, objectId, run) {
    const entry = {tenantId: session.tenantId, actorId: session.actorId, traceId, action, objectId: /^(?:sub|del)_[a-f0-9-]{36}$/.test(objectId) ? objectId : ['MICROSOFT_GRAPH', 'PROCLAIM'].includes(objectId) ? objectId : 'MICROSOFT_GRAPH'};
    // Fail closed before changing connector state if the audit store is unavailable.
    platform.store.audit({...entry, outcome: 'ATTEMPT'});
    try {
      const result = await run();
      platform.store.audit({...entry, objectId: /^(?:sub|del)_[a-f0-9-]{36}$/.test(result?.id) ? result.id : entry.objectId, outcome: 'SUCCESS'});
      return result;
    } catch (error) {
      platform.store.audit({...entry, outcome: 'FAILED', reason: error.status < 500 ? error.code : 'INTERNAL_ERROR'});
      throw error;
    }
  }
  return http.createServer(async (req, res) => {
    const traceId = safeTraceId(req);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && serveStatic(res, uiRoot, url.pathname)) return;
      if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, {status: 'ok'}, traceId);

      const session = await authProvider.authenticate(req.headers);
      if (integrations && (url.pathname === '/api/v1/integrations' || url.pathname.startsWith('/api/v1/integrations/'))) {
        requireCapability(session, req.method === 'GET' ? 'integration:read' : 'integration:manage');
        // A shared harness is bound to one tenant. Never trust capability possession alone.
        const connector = url.pathname.startsWith('/api/v1/integrations/proclaim') ? integrations.proclaim : integrations.graph;
        const kind = connector === integrations.proclaim ? 'PROCLAIM' : 'MICROSOFT_GRAPH';
        if (connector?.tenantId !== session.tenantId || !integrations.registry.get(session.tenantId, kind)) {
          throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/matters') {
        requireCapability(session, 'matter:read');
        return send(res, 200, {items: platform.listMatters(session.tenantId), next_cursor: null}, traceId);
      }

      const matterMatch = url.pathname.match(/^\/api\/v1\/matters\/([^/]+)$/);
      if (req.method === 'GET' && matterMatch) {
        requireCapability(session, 'matter:read');
        const matter = platform.getMatter(session.tenantId, decodeURIComponent(matterMatch[1]));
        if (!matter) throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
        return send(res, 200, {matter}, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/inbound-events') {
        requireCapability(session, 'inbound:read');
        return send(res, 200, {items: platform.listEvents(session.tenantId, Number(url.searchParams.get('limit') || 50)), next_cursor: null}, traceId);
      }

      const eventMatch = url.pathname.match(/^\/api\/v1\/inbound-events\/([^/]+)$/);
      if (req.method === 'GET' && eventMatch) {
        requireCapability(session, 'inbound:read');
        const event = platform.getEvent(session.tenantId, decodeURIComponent(eventMatch[1]));
        if (!event) throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
        return send(res, 200, {event}, traceId);
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/inbound-events') {
        requireCapability(session, 'inbound:create');
        const body = await readJson(req);
        assertBodyTenant(body, session);
        const result = platform.ingest({tenantId: session.tenantId, idempotencyKey: idempotencyKey(req), input: decodeInboundBody(body)});
        return send(res, 202, result, result.traceId || traceId);
      }

      const reconcileWriteback = url.pathname.match(/^\/api\/v1\/inbound-events\/([^/]+)\/reconcile-writeback$/);
      if (req.method === 'POST' && reconcileWriteback) {
        requireCapability(session, 'integration:manage');
        requireCapability(session, 'inbound:read');
        const body = await readJson(req); assertBodyTenant(body, session);
        const result = platform.requestWritebackReconciliation({tenantId: session.tenantId, eventId: decodeURIComponent(reconcileWriteback[1]), actorId: session.actorId, idempotencyKey: idempotencyKey(req)});
        return send(res, 202, result, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/exceptions') {
        requireCapability(session, 'exception:read');
        return send(res, 200, {items: platform.listExceptions(session.tenantId), next_cursor: null}, traceId);
      }

      const exceptionMatch = url.pathname.match(/^\/api\/v1\/exceptions\/([^/]+)\/resolve$/);
      if (req.method === 'POST' && exceptionMatch) {
        requireCapability(session, 'exception:resolve');
        const body = await readJson(req);
        assertBodyTenant(body, session);
        const result = platform.resolveException({tenantId: session.tenantId, exceptionId: decodeURIComponent(exceptionMatch[1]), resolution: body.resolution, matterId: body.matterId || null, notes: body.notes || null, actorId: session.actorId, idempotencyKey: idempotencyKey(req)});
        return send(res, 200, result, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/audit') {
        requireCapability(session, 'audit:read');
        return send(res, 200, {items: platform.audits(session.tenantId), next_cursor: null}, traceId);
      }

      if (integrations && req.method === 'GET' && url.pathname === '/api/v1/integrations') {
        requireCapability(session, 'integration:read');
        const summary = integrations.summary(session.tenantId);
        return send(res, 200, summary, traceId);
      }

      if (integrations && req.method === 'GET' && url.pathname === '/api/v1/integrations/graph') {
        requireCapability(session, 'integration:read');
        return send(res, 200, integrations.graph.snapshot(), traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/graph/subscriptions') {
        requireCapability(session, 'integration:manage');
        const body = await readJson(req); assertBodyTenant(body, session);
        if (!body.mailboxId || typeof body.mailboxId !== 'string') throw appError('mailboxId required',{code:'INVALID_REQUEST'});
        const subscription=await integrationMutation(session, traceId, 'GRAPH_SUBSCRIPTION_CREATE', 'MICROSOFT_GRAPH', () => integrations.graph.createMailboxSubscription(body.mailboxId, body.folder ?? 'Inbox'));
        return send(res, 201, {subscription}, traceId);
      }

      const graphRenew=url.pathname.match(/^\/api\/v1\/integrations\/graph\/subscriptions\/([^/]+)\/renew$/);
      if (integrations && req.method === 'POST' && graphRenew) {
        requireCapability(session, 'integration:manage');
        const id=decodeURIComponent(graphRenew[1]);
        const body=await readJson(req); assertBodyTenant(body,session);
        const subscription=await integrationMutation(session, traceId, 'GRAPH_SUBSCRIPTION_RENEW', id, () => integrations.graph.renewSubscription(id));
        return send(res, 200, {subscription}, traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/graph/delta-checkpoints') {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        if(!body.mailboxId||!body.deltaToken) throw appError('mailboxId and deltaToken required',{code:'INVALID_REQUEST'});
        const checkpoint=await integrationMutation(session, traceId, 'GRAPH_DELTA_CHECKPOINT_SET', 'MICROSOFT_GRAPH', () => integrations.graph.setDelta(body.mailboxId,body.deltaToken));
        return send(res,200,checkpoint,traceId);
      }

      const graphLifecycle=url.pathname.match(/^\/api\/v1\/integrations\/graph\/subscriptions\/([^/]+)\/lifecycle$/);
      if (integrations && req.method === 'POST' && graphLifecycle) {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        if(!body.status) throw appError('status required',{code:'INVALID_REQUEST'});
        const id=decodeURIComponent(graphLifecycle[1]);
        const subscription=await integrationMutation(session, traceId, 'GRAPH_SUBSCRIPTION_LIFECYCLE', id, () => integrations.graph.lifecycle(id,body.status));
        return send(res,200,{subscription},traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/graph/webhooks/simulate') {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        if(!body.subscriptionId) throw appError('subscriptionId required',{code:'INVALID_REQUEST'});
        const delivery=await integrationMutation(session, traceId, 'GRAPH_WEBHOOK_SIMULATE', 'MICROSOFT_GRAPH', () => integrations.graph.receiveNotification({subscriptionId:body.subscriptionId,notificationId:body.notificationId ?? null,resourceId:body.resourceId ?? 'synthetic-resource',changeType:body.changeType ?? 'updated',clientStateValid:body.clientStateValid === undefined ? true : body.clientStateValid}));
        return send(res,202,{delivery},traceId);
      }

      const graphDeliveryFail=url.pathname.match(/^\/api\/v1\/integrations\/graph\/deliveries\/([^/]+)\/fail$/);
      if (integrations && req.method === 'POST' && graphDeliveryFail) {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        const id=decodeURIComponent(graphDeliveryFail[1]);
        const delivery=await integrationMutation(session, traceId, 'GRAPH_DELIVERY_FAIL', id, () => integrations.graph.failDelivery(id,body.error ?? 'synthetic failure'));
        return send(res,200,{delivery},traceId);
      }

      const graphDeliveryRetry=url.pathname.match(/^\/api\/v1\/integrations\/graph\/deliveries\/([^/]+)\/retry$/);
      if (integrations && req.method === 'POST' && graphDeliveryRetry) {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        const id=decodeURIComponent(graphDeliveryRetry[1]);
        const delivery=await integrationMutation(session, traceId, 'GRAPH_DELIVERY_RETRY', id, () => integrations.graph.retryDelivery(id));
        return send(res,200,{delivery},traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/proclaim/validate') {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        if (body.externalMatterId != null && (typeof body.externalMatterId !== 'string' || !body.externalMatterId.trim() || body.externalMatterId.length > 512)) throw appError('invalid request', {code:'INVALID_REQUEST'});
        const result=await integrationMutation(session, traceId, 'PROCLAIM_VALIDATION_RUN', 'PROCLAIM', () => integrations.proclaim.runValidation({externalMatterId:body.externalMatterId ?? 'PROCLAIM-DEMO-1'}));
        return send(res,200,{result},traceId);
      }

      if (devWorkers && req.method === 'POST' && url.pathname === '/api/v1/dev/workers/drain-one') {
        requireCapability(session, 'dev:workers');
        requireCapability(session, 'inbound:read');
        const body = await readJson(req);
        assertBodyTenant(body, session);
        if (body.eventId != null && (typeof body.eventId !== 'string' || !body.eventId || body.eventId.length > 200)) throw appError('invalid eventId', {code:'INVALID_REQUEST'});
        if (body.eventId != null && !platform.getEvent(session.tenantId, body.eventId)) throw appError('resource unavailable', {status:404,code:'NOT_FOUND'});
        const workerContext = {tenantId: session.tenantId, eventId: body.eventId ?? null};
        const result = body.worker === 'inbound' ? await platform.processNext(workerContext)
          : body.worker === 'writeback' ? await platform.processWritebackNext(workerContext)
          : (() => { throw appError('unknown worker', {code: 'INVALID_WORKER'}); })();
        return send(res, 200, {result}, traceId);
      }

      throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
    } catch (error) {
      const status = Number(error.status) || 500;
      const code = error.code || 'INTERNAL_ERROR';
      const message = status >= 500 ? 'internal error' : String(error.message || 'request failed');
      return send(res, status, {code, message, trace_id: traceId}, traceId);
    }
  });
}
