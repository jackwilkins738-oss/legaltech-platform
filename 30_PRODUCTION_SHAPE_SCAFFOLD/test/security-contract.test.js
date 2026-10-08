import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestContext, requireCapability, canAccessMatter, canAccessDocument } from '../src/auth.js';
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
  assert.throws(() => canAccessMatter(ctx,{id:'m-zone',tenantId:'t-a',securityZoneId:'z-secret'}), /NOT_FOUND/);
});



test('restricted matter requires explicit server-derived membership before zone evaluation', () => {
  const noMembership=buildRequestContext({...session,securityZoneIds:['z-secret']});
  assert.throws(()=>canAccessMatter(noMembership,{id:'m-private',tenantId:'t-a',visibility:'PRIVATE',securityZoneId:'z-secret'}),/NOT_FOUND/);
  const member=buildRequestContext({...session,securityZoneIds:['z-secret'],matterMembershipIds:['m-private']});
  assert.equal(canAccessMatter(member,{id:'m-private',tenantId:'t-a',visibility:'PRIVATE',securityZoneId:'z-secret'}),true);
});

test('document restriction is additional to matter access and can be stricter than the matter', () => {
  const matter={id:'m-a',tenantId:'t-a',visibility:'STANDARD'};
  const restricted={tenantId:'t-a',matterId:'m-a',documentRef:'doc-secret',mode:'PRIVILEGED'};
  const base=buildRequestContext(session);
  assert.throws(()=>canAccessDocument(base,restricted,matter),/NOT_FOUND/);
  const allowed=buildRequestContext({...session,documentAccessRefs:['doc-secret']});
  assert.equal(canAccessDocument(allowed,restricted,matter),true);
  assert.throws(()=>canAccessDocument(allowed,{...restricted,matterId:'m-other'},matter),/NOT_FOUND/);
});

test('forensic trace id is generated server-side and ignores a supplied session trace id', () => {
  const a=buildRequestContext({...session,traceId:'attacker-chosen-trace'});
  const b=buildRequestContext({...session,traceId:'attacker-chosen-trace'});
  assert.match(a.traceId,/^[0-9a-f-]{36}$/i);
  assert.notEqual(a.traceId,'attacker-chosen-trace');
  assert.notEqual(a.traceId,b.traceId);
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

test('break-glass capability alone cannot bypass a restricted matter', () => {
  const ctx=buildRequestContext({...session,capabilities:['matter.read','matter.break_glass']});
  assert.throws(() => canAccessMatter(ctx,{id:'m-secret',tenantId:'t-a',securityZoneId:'z-secret'}), /NOT_FOUND/);
});

test('break-glass requires short-lived step-up evidence bound to the exact matter', () => {
  const now=Date.parse('2026-10-08T12:00:00.000Z');
  const ctx=buildRequestContext({...session,capabilities:['matter.read','matter.break_glass'],breakGlassGrants:[{
    grantId:'bg-1',matterId:'m-secret',reason:'Emergency continuity access',issuedAt:'2026-10-08T11:55:00.000Z',expiresAt:'2026-10-08T12:05:00.000Z',stepUpVerified:true,
  }]});
  assert.equal(canAccessMatter(ctx,{id:'m-secret',tenantId:'t-a',securityZoneId:'z-secret'},{now}),true);
  assert.throws(() => canAccessMatter(ctx,{id:'m-other',tenantId:'t-a',securityZoneId:'z-secret'},{now}), /NOT_FOUND/);
  assert.throws(() => canAccessMatter(ctx,{id:'m-secret',tenantId:'t-a',securityZoneId:'z-secret'},{now:Date.parse('2026-10-08T12:06:00.000Z')}), /NOT_FOUND/);
});

test('production requires OIDC managed infrastructure and restricted DB role', () => {
  const base={NODE_ENV:'production',DATABASE_URL:'postgresql://runtime:secret@db/prod',AUTH_MODE:'oidc',OIDC_ISSUER:'https://login.example.test/tenant/v2.0',OIDC_AUDIENCE:'api://legaltech',SECRET_STORE_MODE:'managed',OBJECT_STORAGE_MODE:'managed-object-storage',QUEUE_MODE:'managed-queue',SESSION_STORE_MODE:'managed-session',RATE_LIMIT_MODE:'managed-rate-limit',AUDIT_SINK_MODE:'managed-audit',DATABASE_ROLE_MODE:'restricted-runtime'};
  assert.doesNotThrow(()=>validateEnv(base));
  assert.throws(()=>validateEnv({...base,AUTH_MODE:'mock'}),/INSECURE_PRODUCTION_AUTH_MODE/);
  assert.throws(()=>validateEnv({...base,SECRET_STORE_MODE:'local'}),/INSECURE_SECRET_STORE_MODE/);
  assert.throws(()=>validateEnv({...base,DATABASE_ROLE_MODE:'owner'}),/INSECURE_DATABASE_ROLE_MODE/);
});

test('real client data fails closed until external security evidence gates pass', () => {
  const base={NODE_ENV:'production',DATABASE_URL:'postgresql://runtime:secret@db/prod',AUTH_MODE:'oidc',OIDC_ISSUER:'https://login.example.test/tenant/v2.0',OIDC_AUDIENCE:'api://legaltech',SECRET_STORE_MODE:'managed',OBJECT_STORAGE_MODE:'managed-object-storage',QUEUE_MODE:'managed-queue',SESSION_STORE_MODE:'managed-session',RATE_LIMIT_MODE:'managed-rate-limit',AUDIT_SINK_MODE:'managed-audit',DATABASE_ROLE_MODE:'restricted-runtime',ALLOW_REAL_CLIENT_DATA:'true'};
  assert.throws(()=>validateEnv(base),/REAL_CLIENT_DATA_GATE_/);
  assert.doesNotThrow(()=>validateEnv({...base,PRODUCTION_SECURITY_APPROVED:'true',INDEPENDENT_PEN_TEST_STATUS:'PASS',SESSION_REVOCATION_STATUS:'PASS',OIDC_STEP_UP_STATUS:'PASS',SECRETS_KMS_STATUS:'PASS',NETWORK_ISOLATION_STATUS:'PASS',MONITORING_STATUS:'PASS',AUDIT_EXPORT_STATUS:'PASS',BACKUP_ENCRYPTION_STATUS:'PASS',RESTORE_TEST_STATUS:'PASS',MALWARE_SCAN_MODE:'managed',PARSER_ISOLATION_MODE:'isolated',GRAPH_LIVE_VALIDATED:'true',PROCLAIM_LIVE_VALIDATED:'true'}));
});
