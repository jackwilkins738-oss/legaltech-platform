import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {appError,publicError} from './errors.js';
import {isUtf8} from 'node:buffer';
import {decodeInboundBody} from './inboundRequest.js';
import {requireCapability,normalizeSession,assertMatterAccess,matterAccessAllowed} from './auth.js';
import {InMemoryAbuseLimiter} from './abuseControl.js';
import {redactPublicIntegrationData} from './secretManagement.js';

const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
]);

function assertSingleSecurityHeaders(req) {
  const counts=new Map();
  for(let i=0;i<req.rawHeaders.length;i+=2) {
    const name=req.rawHeaders[i].toLowerCase();
    if(!['authorization','idempotency-key'].includes(name)) continue;
    counts.set(name,(counts.get(name)??0)+1);
    if(counts.get(name)>1) throw appError('ambiguous security headers',{code:'INVALID_REQUEST'});
  }
}
function routeId(value) {
  try { return decodeURIComponent(value); }
  catch { throw appError('invalid route encoding',{code:'INVALID_REQUEST'}); }
}
function requestUrl(value) {
  try { return new URL(value,'http://localhost'); }
  catch { throw appError('invalid request URL',{code:'INVALID_REQUEST'}); }
}

function serverTraceId() { return `trc_${crypto.randomUUID()}`; }
function boundedLimit(url,{name='limit',fallback=50,max=200}={}) {
  const raw=url.searchParams.get(name);
  if(raw===null) return fallback;
  if(!/^[1-9][0-9]{0,5}$/.test(raw)) throw appError('invalid pagination limit',{code:'INVALID_REQUEST'});
  return Math.min(Number(raw),max);
}
function linkedMatterIds(event) {
  if(!event||typeof event!=='object') return [];
  return [...new Set([event.approvedMatterId,event.match?.matterId].filter(value=>typeof value==='string'&&value))];
}
function assertEventMatterAccess(session,platform,event) {
  for(const matterId of linkedMatterIds(event)) {
    const matter=platform.getMatter(session.tenantId,matterId);
    if(!matter) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
    assertMatterAccess(session,matter);
  }
}
function eventVisible(session,platform,event) {
  try { assertEventMatterAccess(session,platform,event); return true; } catch(error) { return error?.code==='NOT_FOUND'?false:(()=>{throw error;})(); }
}

function send(res, status, payload, traceId, extraHeaders={}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-trace-id': traceId,
    ...extraHeaders,
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
    const bytes=Buffer.concat(chunks);
    if(!isUtf8(bytes)) throw appError('invalid json',{code:'INVALID_JSON'});
    const body = JSON.parse(bytes.toString('utf8'));
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

export function createApiServer({platform, authProvider, devWorkers = false, uiRoot = null, integrations = null, abuseLimiter = new InMemoryAbuseLimiter(), identitySessionService = null}) {
  async function integrationMutation(session, traceId, action, objectId, run) {
    const entry = {tenantId: session.tenantId, actorId: session.actorId, traceId, action, objectId: /^(?:sub|del)_[a-f0-9-]{36}$/.test(objectId) ? objectId : ['MICROSOFT_GRAPH', 'PROCLAIM'].includes(objectId) ? objectId : 'MICROSOFT_GRAPH'};
    // Fail closed before changing connector state if the audit store is unavailable.
    platform.store.audit({...entry, outcome: 'ATTEMPT'});
    try {
      const result = await run();
      platform.store.audit({...entry, objectId: /^(?:sub|del)_[a-f0-9-]{36}$/.test(result?.id) ? result.id : entry.objectId, outcome: 'SUCCESS'});
      return result;
    } catch (error) {
      platform.store.audit({...entry, outcome: 'FAILED', reason: publicError(error).code});
      throw error;
    }
  }
  return http.createServer(async (req, res) => {
    const traceId = serverTraceId();
    try {
      abuseLimiter.checkIp(req);
      assertSingleSecurityHeaders(req);
      const url = requestUrl(req.url);
      if (req.method === 'GET' && serveStatic(res, uiRoot, url.pathname)) return;
      if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, {status: 'ok'}, traceId);
      if (identitySessionService && req.method === 'POST' && url.pathname === '/api/v1/auth/session') {
        const exchanged=await identitySessionService.exchange(req.headers);
        return send(res,200,{status:'AUTHENTICATED',expiresAt:exchanged.expiresAt},traceId,{'set-cookie':exchanged.setCookie});
      }
      if (identitySessionService && req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        const loggedOut=identitySessionService.logout(req.headers);
        return send(res,200,{status:'SIGNED_OUT'},traceId,{'set-cookie':loggedOut.setCookie});
      }

      const session = normalizeSession(await authProvider.authenticate(req.headers,{method:req.method,url:url.pathname}));
      abuseLimiter.checkTenant(session);
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
        const limit=boundedLimit(url,{fallback:100,max:200});
        const items=platform.listMatters(session.tenantId,limit).filter(matter=>matterAccessAllowed(session,matter));
        return send(res, 200, {items, next_cursor: null}, traceId);
      }

      const matterMatch = url.pathname.match(/^\/api\/v1\/matters\/([^/]+)$/);
      if (req.method === 'GET' && matterMatch) {
        requireCapability(session, 'matter:read');
        const matter = platform.getMatter(session.tenantId, routeId(matterMatch[1]));
        if (!matter) throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
        assertMatterAccess(session,matter);
        return send(res, 200, {matter}, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/inbound-events') {
        requireCapability(session, 'inbound:read');
        const limit=boundedLimit(url,{fallback:50,max:200});
        const items=platform.listEvents(session.tenantId,limit).filter(event=>eventVisible(session,platform,event));
        return send(res, 200, {items, next_cursor: null}, traceId);
      }

      const eventMatch = url.pathname.match(/^\/api\/v1\/inbound-events\/([^/]+)$/);
      if (req.method === 'GET' && eventMatch) {
        requireCapability(session, 'inbound:read');
        const event = platform.getEvent(session.tenantId, routeId(eventMatch[1]));
        if (!event) throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
        assertEventMatterAccess(session,platform,event);
        return send(res, 200, {event}, traceId);
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/inbound-events') {
        requireCapability(session, 'inbound:create');
        const body = await readJson(req);
        assertBodyTenant(body, session);
        const result = platform.ingest({tenantId: session.tenantId, idempotencyKey: idempotencyKey(req), input: decodeInboundBody(body)});
        return send(res, 202, result, result.traceId || traceId);
      }

      const retryInbound=url.pathname.match(/^\/api\/v1\/inbound-events\/([^/]+)\/retry-processing$/);
      if (devWorkers&&req.method==='POST'&&retryInbound) {
        requireCapability(session,'dev:workers');requireCapability(session,'inbound:read');
        const body=await readJson(req);assertBodyTenant(body,session);
        if (Object.keys(body).some(key=>key!=='tenantId')) throw appError('invalid recovery request',{code:'INVALID_REQUEST'});
        const result=platform.requestInboundRecovery({tenantId:session.tenantId,eventId:routeId(retryInbound[1]),actorId:session.actorId,idempotencyKey:idempotencyKey(req)});
        return send(res,202,result,traceId);
      }

      const reconcileWriteback = url.pathname.match(/^\/api\/v1\/inbound-events\/([^/]+)\/reconcile-writeback$/);
      if (req.method === 'POST' && reconcileWriteback) {
        requireCapability(session, 'integration:manage');
        requireCapability(session, 'inbound:read');
        const body = await readJson(req); assertBodyTenant(body, session);
        const event=platform.getEvent(session.tenantId,routeId(reconcileWriteback[1]));
        if(!event) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
        assertEventMatterAccess(session,platform,event);
        const result = platform.requestWritebackReconciliation({tenantId: session.tenantId, eventId: routeId(reconcileWriteback[1]), actorId: session.actorId, idempotencyKey: idempotencyKey(req)});
        return send(res, 202, result, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/exceptions') {
        requireCapability(session, 'exception:read');
        const limit=boundedLimit(url,{fallback:100,max:200});
        const items=platform.listExceptions(session.tenantId,limit).filter(ex=>{
          const event=platform.getEvent(session.tenantId,ex.eventId);
          return event&&eventVisible(session,platform,event);
        });
        return send(res, 200, {items, next_cursor: null}, traceId);
      }

      const exceptionMatch = url.pathname.match(/^\/api\/v1\/exceptions\/([^/]+)\/resolve$/);
      if (req.method === 'POST' && exceptionMatch) {
        requireCapability(session, 'exception:resolve');
        const body = await readJson(req);
        assertBodyTenant(body, session);
        if (Object.keys(body).some(key=>!['tenantId','resolution','matterId','notes'].includes(key))) throw appError('invalid review request',{code:'INVALID_REQUEST'});
        if(body.matterId!=null&&(typeof body.matterId!=='string'||!body.matterId.trim()||body.matterId.length>200||/[\x00-\x1f\x7f]/.test(body.matterId)))throw appError('invalid review request',{code:'INVALID_REQUEST'});
        if(body.notes!=null&&(typeof body.notes!=='string'||body.notes.length>4096||/[\x00\x7f]/.test(body.notes)))throw appError('invalid review request',{code:'INVALID_REQUEST'});
        if(typeof platform.getException==='function'&&typeof platform.getEvent==='function'){
          const ex=platform.getException(session.tenantId,routeId(exceptionMatch[1]));
          if(!ex) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
          const event=platform.getEvent(session.tenantId,ex.eventId);
          if(!event) throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
          assertEventMatterAccess(session,platform,event);
          if(body.matterId!=null&&typeof platform.getMatter==='function'){const matter=platform.getMatter(session.tenantId,body.matterId);if(!matter)throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});assertMatterAccess(session,matter);}
        }
        const result = platform.resolveException({tenantId: session.tenantId, exceptionId: routeId(exceptionMatch[1]), resolution: body.resolution, matterId: body.matterId ?? null, notes: body.notes ?? null, actorId: session.actorId, idempotencyKey: idempotencyKey(req)});
        return send(res, 200, result, traceId);
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/audit') {
        requireCapability(session, 'audit:read');
        const limit=boundedLimit(url,{fallback:100,max:500});
        const items=platform.audits(session.tenantId,limit).filter(item=>{
          if(!item.matterId) return true;
          const matter=platform.getMatter(session.tenantId,item.matterId);
          return matter&&matterAccessAllowed(session,matter);
        });
        return send(res, 200, {items, next_cursor: null}, traceId);
      }

      if (integrations && req.method === 'GET' && url.pathname === '/api/v1/integrations') {
        requireCapability(session, 'integration:read');
        const summary = integrations.summary(session.tenantId);
        return send(res, 200, redactPublicIntegrationData(summary), traceId);
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
        const id=routeId(graphRenew[1]);
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
        const id=routeId(graphLifecycle[1]);
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
        const id=routeId(graphDeliveryFail[1]);
        const delivery=await integrationMutation(session, traceId, 'GRAPH_DELIVERY_FAIL', id, () => integrations.graph.failDelivery(id,body.error ?? 'synthetic failure'));
        return send(res,200,{delivery},traceId);
      }

      const graphDeliveryRetry=url.pathname.match(/^\/api\/v1\/integrations\/graph\/deliveries\/([^/]+)\/retry$/);
      if (integrations && req.method === 'POST' && graphDeliveryRetry) {
        requireCapability(session, 'integration:manage');
        const body=await readJson(req); assertBodyTenant(body,session);
        const id=routeId(graphDeliveryRetry[1]);
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
        if (body.eventId != null) {
          const event=platform.getEvent(session.tenantId,body.eventId);
          if(!event) throw appError('resource unavailable', {status:404,code:'NOT_FOUND'});
          assertEventMatterAccess(session,platform,event);
        }
        const workerContext = {tenantId: session.tenantId, eventId: body.eventId ?? null};
        const result = body.worker === 'inbound' ? await platform.processNext(workerContext)
          : body.worker === 'writeback' ? await platform.processWritebackNext(workerContext)
          : (() => { throw appError('unknown worker', {code: 'INVALID_WORKER'}); })();
        return send(res, 200, {result}, traceId);
      }

      throw appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
    } catch (error) {
      const {status,code,message}=publicError(error);
      return send(res, status, {code, message, trace_id: traceId}, traceId);
    }
  });
}
