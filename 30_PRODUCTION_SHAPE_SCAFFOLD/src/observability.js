const sensitiveKeys = new Set([
  'body','content','documentText','medicalDetails','clientName','password','secret','token','accessToken','refreshToken','signedUrl'
]);

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sensitiveKeys.has(key) ? '[REDACTED]' : redact(item);
  }
  return out;
}

export function logEnvelope({ level='info', service, environment, traceId, tenantId, operation, outcome, errorCode, durationMs, extra={} }) {
  return redact({
    timestamp: new Date().toISOString(), level, service, environment, trace_id: traceId,
    tenant_id: tenantId, operation, outcome, error_code: errorCode ?? null,
    duration_ms: durationMs ?? null, ...extra
  });
}
