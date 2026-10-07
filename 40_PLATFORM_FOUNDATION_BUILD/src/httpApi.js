import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {appError} from './errors.js';
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
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

function inboundFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw appError('invalid request', {code: 'INVALID_REQUEST'});
  const sourceSystem = body.sourceSystem || 'MANUAL';
  if (!['MANUAL', 'MANUAL_UPLOAD', 'MICROSOFT_GRAPH'].includes(sourceSystem)) {
    throw appError('unsupported source system', {code: 'INVALID_SOURCE_SYSTEM'});
  }
  if (body.subject != null && typeof body.subject !== 'string') throw appError('invalid subject', {code: 'INVALID_REQUEST'});
  if (body.body != null && typeof body.body !== 'string') throw appError('invalid body', {code: 'INVALID_REQUEST'});
  if (body.attachments != null && !Array.isArray(body.attachments)) throw appError('invalid attachments', {code: 'INVALID_REQUEST'});
  const attachments = (body.attachments || []).map((a) => {
    if (!a || typeof a.filename !== 'string') throw appError('invalid attachment', {code: 'INVALID_REQUEST'});
    const bytes = a.base64 ? Buffer.from(a.base64, 'base64') : Buffer.from(a.text || '', 'utf8');
    return {filename: a.filename, contentType: a.contentType || 'application/octet-stream', bytes};
  });
  return {sourceSystem, externalEventId: body.externalEventId || null, subject: body.subject || '', body: body.body || '', attachments};
}

export function createApiServer({platform, authProvider, devWorkers = false, uiRoot = null, integrations = null}) {
  return http.createServer(async (req, res) => {
    const traceId = safeTraceId(req);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && serveStatic(res, uiRoot, url.pathname)) return;
      if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, {status: 'ok'}, traceId);

      const session = await authProvider.authenticate(req.headers);

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
        const result = platform.ingest({tenantId: session.tenantId, idempotencyKey: idempotencyKey(req), input: inboundFromBody(body)});
        return send(res, 202, result, result.traceId || traceId);
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
        return send(res, 200, integrations.summary(session.tenantId), traceId);
      }

      if (integrations && req.method === 'GET' && url.pathname === '/api/v1/integrations/graph') {
        requireCapability(session, 'integration:read');
        return send(res, 200, integrations.graph.snapshot(), traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/graph/subscriptions') {
        requireCapability(session, 'integration:manage');
        const body = await readJson(req); assertBodyTenant(body, session);
        if (!body.mailboxId || typeof body.mailboxId !== 'string') throw appError('mailboxId required',{code:'INVALID_REQUEST'});
        const subscription=integrations.graph.createMailboxSubscription(body.mailboxId, body.folder || 'Inbox');
        return send(res, 201, {subscription}, traceId);
      }

      const graphRenew=url.pathname.match(/^\/api\/v1\/integrations\/graph\/subscriptions\/([^/]+)\/renew$/);
      if (integrations && req.method === 'POST' && graphRenew) {
        requireCapability(session, 'integration:manage');
        const subscription=integrations.graph.renewSubscription(decodeURIComponent(graphRenew[1]));
        return send(res, 200, {subscription}, traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/graph/delta-checkpoints') {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        if(!body.mailboxId||!body.deltaToken) throw appError('mailboxId and deltaToken required',{code:'INVALID_REQUEST'});
        return send(res,200,integrations.graph.setDelta(body.mailboxId,body.deltaToken),traceId);
      }

      if (integrations && req.method === 'POST' && url.pathname === '/api/v1/integrations/proclaim/validate') {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        const result=await integrations.proclaim.runValidation({externalMatterId:body.externalMatterId||'PROCLAIM-DEMO-1'});
        return send(res,200,{result},traceId);
      }

      if (devWorkers && req.method === 'POST' && url.pathname === '/api/v1/dev/workers/drain-one') {
        requireCapability(session, 'dev:workers');
        const body = await readJson(req);
        const result = body.worker === 'inbound' ? await platform.processNext()
          : body.worker === 'writeback' ? await platform.processWritebackNext()
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
