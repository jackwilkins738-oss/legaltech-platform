import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestContext, requireCapability, canAccessMatter } from '../src/auth.js';
import { redact } from '../src/observability.js';
import { validateEnv } from '../src/env.js';

const session = { status:'ACTIVE', tenantId:'t-a', actorId:'u-a', capabilities:['matter.read'], securityZoneIds:['z-a'], traceId:'tr-1' };

test('inactive sessions are rejected', () => {
  assert.throws(() => buildRequestContext({...session,status:'DISABLED'}), /UNAUTHENTICATED/);
});

test('capability enforcement rejects missing privilege', () => {
  const ctx=buildRequestContext(session);
  assert.throws(() => requireCapability(ctx,'matter.write'), /FORBIDDEN/);
});

test('cross-tenant matter appears not found', () => {
  const ctx=buildRequestContext(session);
  assert.throws(() => canAccessMatter(ctx,{tenantId:'t-b'}), /NOT_FOUND/);
});

test('security zone denial appears not found', () => {
  const ctx=buildRequestContext(session);
  assert.throws(() => canAccessMatter(ctx,{tenantId:'t-a',securityZoneId:'z-secret'}), /NOT_FOUND/);
});

test('observability redacts content and tokens recursively', () => {
  const v=redact({clientName:'Alice', nested:{body:'secret',ok:3},accessToken:'abc'});
  assert.equal(v.clientName,'[REDACTED]');
  assert.equal(v.nested.body,'[REDACTED]');
  assert.equal(v.nested.ok,3);
  assert.equal(v.accessToken,'[REDACTED]');
});

test('production refuses placeholder database credentials', () => {
  assert.throws(() => validateEnv({NODE_ENV:'production',DATABASE_URL:'postgresql://x:change-me@db/x'}), /INSECURE/);
});
