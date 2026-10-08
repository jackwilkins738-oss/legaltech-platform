import crypto from 'node:crypto';

const MAX_BREAK_GLASS_MS = 15 * 60 * 1000;
const matterVisibility = new Set(['STANDARD','TEAM_RESTRICTED','PRIVATE','SECURITY_ZONE']);
const documentModes = new Set(['INHERIT','RESTRICTED','PRIVILEGED','SECURITY_ZONE']);

function cleanIdentifier(value, code='INVALID_SESSION') {
  if (typeof value !== 'string' || !value || value.length > 512 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) throw new Error(code);
  return value;
}
function cleanLabels(value, code='INVALID_SESSION') {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > 512 || value.some(x => typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(x))) throw new Error(code);
  return new Set(value);
}
function cleanBreakGlass(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 16) throw new Error('INVALID_SESSION');
  return Object.freeze(value.map(grant => {
    if (!grant || typeof grant !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(grant))) throw new Error('INVALID_SESSION');
    const issuedAt = Date.parse(grant.issuedAt), expiresAt = Date.parse(grant.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_BREAK_GLASS_MS) throw new Error('INVALID_SESSION');
    if (grant.stepUpVerified !== true || typeof grant.reason !== 'string' || grant.reason.trim().length < 8 || grant.reason.length > 500 || /[\x00-\x1f\x7f]/.test(grant.reason)) throw new Error('INVALID_SESSION');
    return Object.freeze({
      grantId: cleanIdentifier(grant.grantId),
      matterId: cleanIdentifier(grant.matterId),
      reason: grant.reason.trim(),
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      stepUpVerified: true,
    });
  }));
}

export function buildRequestContext(session) {
  if (!session || session.status !== 'ACTIVE') throw new Error('UNAUTHENTICATED');
  if (!session.tenantId || !session.actorId) throw new Error('INVALID_SESSION');
  return Object.freeze({
    tenantId: cleanIdentifier(session.tenantId),
    actorId: cleanIdentifier(session.actorId),
    actorType: session.actorType ?? 'USER',
    capabilities: cleanLabels(session.capabilities),
    securityZoneIds: cleanLabels(session.securityZoneIds),
    matterMembershipIds: cleanLabels(session.matterMembershipIds),
    documentAccessRefs: cleanLabels(session.documentAccessRefs),
    breakGlassGrants: cleanBreakGlass(session.breakGlassGrants),
    // Forensic identity is server-owned. Client/request correlation belongs in a separate field.
    traceId: crypto.randomUUID(),
  });
}

export function requireCapability(ctx, capability) {
  if (!ctx.capabilities.has(capability)) throw new Error('FORBIDDEN');
}

export function assertTenant(ctx, objectTenantId) {
  if (ctx.tenantId !== objectTenantId) throw new Error('NOT_FOUND');
}

function activeBreakGlass(ctx,matterId,now) {
  if (!ctx.capabilities.has('matter.break_glass')) return false;
  return ctx.breakGlassGrants.some(grant => grant.matterId === matterId && grant.stepUpVerified === true && Date.parse(grant.issuedAt) <= now && Date.parse(grant.expiresAt) > now);
}

export function canAccessMatter(ctx, matter, {now=Date.now()}={}) {
  assertTenant(ctx, matter.tenantId);
  const id=cleanIdentifier(matter.id ?? 'missing-matter-id','NOT_FOUND');
  const visibility=matter.visibility ?? 'STANDARD';
  if(!matterVisibility.has(visibility)) throw new Error('NOT_FOUND');
  if(activeBreakGlass(ctx,id,now)) return true;
  if(visibility!=='STANDARD' && !ctx.matterMembershipIds.has(id)) throw new Error('NOT_FOUND');
  if(matter.securityZoneId && !ctx.securityZoneIds.has(matter.securityZoneId)) throw new Error('NOT_FOUND');
  return true;
}

export function canAccessDocument(ctx, document, matter, {now=Date.now()}={}) {
  canAccessMatter(ctx,matter,{now});
  assertTenant(ctx, document.tenantId);
  if(document.matterId !== matter.id) throw new Error('NOT_FOUND');
  const ref=cleanIdentifier(document.documentRef,'NOT_FOUND');
  const mode=document.mode ?? 'INHERIT';
  if(!documentModes.has(mode)) throw new Error('NOT_FOUND');
  if(mode==='INHERIT') return true;
  if(activeBreakGlass(ctx,matter.id,now)) return true;
  if(mode==='SECURITY_ZONE') {
    if(!document.securityZoneId || !ctx.securityZoneIds.has(document.securityZoneId)) throw new Error('NOT_FOUND');
    return true;
  }
  if(!ctx.documentAccessRefs.has(ref)) throw new Error('NOT_FOUND');
  return true;
}
