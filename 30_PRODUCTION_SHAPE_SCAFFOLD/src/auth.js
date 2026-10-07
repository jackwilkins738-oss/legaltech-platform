export function buildRequestContext(session) {
  if (!session || session.status !== 'ACTIVE') throw new Error('UNAUTHENTICATED');
  if (!session.tenantId || !session.actorId) throw new Error('INVALID_SESSION');
  return Object.freeze({
    tenantId: session.tenantId,
    actorId: session.actorId,
    actorType: session.actorType ?? 'USER',
    capabilities: new Set(session.capabilities ?? []),
    securityZoneIds: new Set(session.securityZoneIds ?? []),
    traceId: session.traceId ?? crypto.randomUUID(),
  });
}

export function requireCapability(ctx, capability) {
  if (!ctx.capabilities.has(capability)) throw new Error('FORBIDDEN');
}

export function assertTenant(ctx, objectTenantId) {
  if (ctx.tenantId !== objectTenantId) throw new Error('NOT_FOUND');
}

export function canAccessMatter(ctx, matter) {
  assertTenant(ctx, matter.tenantId);
  if (!matter.securityZoneId) return true;
  if (ctx.capabilities.has('matter.break_glass')) return true;
  if (!ctx.securityZoneIds.has(matter.securityZoneId)) throw new Error('NOT_FOUND');
  return true;
}
