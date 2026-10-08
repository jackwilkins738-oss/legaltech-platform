const allowedEnvironments = new Set(['development','test','staging','production']);
const secureStores = new Set(['managed','key-vault','secrets-manager','secret-manager']);
const localModes = new Set(['local','mock','memory','filesystem','sqlite']);
const workloadIdentityModes = new Set(['workload-identity','managed-identity','oidc-federation']);
const truthy = value => String(value ?? '').toLowerCase() === 'true';

function httpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function httpsOrigin(value) {
  try { const u=new URL(value); return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash; } catch { return false; }
}
function integerInRange(value,min,max) {
  if(!/^[0-9]+$/.test(String(value??''))) return false;
  const n=Number(value); return Number.isInteger(n)&&n>=min&&n<=max;
}
function tenantList(value) {
  return typeof value==='string'&&value.length<=4096&&value.split(',').every(x=>/^[A-Za-z0-9._:-]{1,128}$/.test(x.trim()))&&value.split(',').filter(x=>x.trim()).length>0;
}

export function validateEnv(env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!allowedEnvironments.has(nodeEnv)) throw new Error('INVALID_NODE_ENV');
  if (env.DATABASE_URL && /change-me|local-only-change-me/.test(env.DATABASE_URL) && nodeEnv === 'production') throw new Error('INSECURE_PRODUCTION_DATABASE_URL');

  if (nodeEnv === 'production') {
    const required = ['DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','OIDC_ALLOWED_DIRECTORY_TENANTS','PUBLIC_ORIGIN','SESSION_ABSOLUTE_TTL_MINUTES','SESSION_IDLE_TTL_MINUTES','SECRET_STORE_MODE','OBJECT_STORAGE_MODE','QUEUE_MODE','SESSION_STORE_MODE','RATE_LIMIT_MODE','AUDIT_SINK_MODE','DATABASE_ROLE_MODE','SECRET_STORE_AUTH_MODE','CONNECTOR_CREDENTIAL_MODE','CONNECTOR_SECRET_CACHE_MODE','GRAPH_CREDENTIAL_SCOPE_MODE','PROCLAIM_CREDENTIAL_SCOPE_MODE','CONNECTOR_CREDENTIAL_GENERATION_STORE_MODE','SECURITY_MONITORING_MODE','SECURITY_ALERT_SINK_MODE','SECURITY_LOG_REDACTION_MODE','AUDIT_CHAIN_MODE','INCIDENT_CORRELATION_MODE','SECURITY_LOG_RETENTION_DAYS'];
    for (const key of required) if (!env[key]) throw new Error(`MISSING_${key}`);
    if (env.AUTH_MODE !== 'oidc') throw new Error('INSECURE_PRODUCTION_AUTH_MODE');
    if (!httpsUrl(env.OIDC_ISSUER)) throw new Error('INSECURE_OIDC_ISSUER');
    if (!httpsUrl(env.OIDC_JWKS_URI)) throw new Error('INSECURE_OIDC_JWKS_URI');
    if (new URL(env.OIDC_JWKS_URI).origin !== new URL(env.OIDC_ISSUER).origin) throw new Error('OIDC_JWKS_ORIGIN_MISMATCH');
    if (!tenantList(env.OIDC_ALLOWED_DIRECTORY_TENANTS)) throw new Error('INVALID_OIDC_ALLOWED_DIRECTORY_TENANTS');
    if (!httpsOrigin(env.PUBLIC_ORIGIN)) throw new Error('INSECURE_PUBLIC_ORIGIN');
    if (!integerInRange(env.SESSION_ABSOLUTE_TTL_MINUTES,5,1440)) throw new Error('INVALID_SESSION_ABSOLUTE_TTL');
    if (!integerInRange(env.SESSION_IDLE_TTL_MINUTES,1,120) || Number(env.SESSION_IDLE_TTL_MINUTES) > Number(env.SESSION_ABSOLUTE_TTL_MINUTES)) throw new Error('INVALID_SESSION_IDLE_TTL');
    if (!secureStores.has(env.SECRET_STORE_MODE)) throw new Error('INSECURE_SECRET_STORE_MODE');
    if (!workloadIdentityModes.has(env.SECRET_STORE_AUTH_MODE)) throw new Error('INSECURE_SECRET_STORE_AUTH_MODE');
    if (env.CONNECTOR_CREDENTIAL_MODE !== 'brokered-managed') throw new Error('INSECURE_CONNECTOR_CREDENTIAL_MODE');
    if (env.CONNECTOR_SECRET_CACHE_MODE !== 'none') throw new Error('INSECURE_CONNECTOR_SECRET_CACHE_MODE');
    if (env.GRAPH_CREDENTIAL_SCOPE_MODE !== 'least-privilege') throw new Error('INSECURE_GRAPH_CREDENTIAL_SCOPE_MODE');
    if (env.PROCLAIM_CREDENTIAL_SCOPE_MODE !== 'least-privilege') throw new Error('INSECURE_PROCLAIM_CREDENTIAL_SCOPE_MODE');
    if (env.CONNECTOR_CREDENTIAL_GENERATION_STORE_MODE !== 'durable') throw new Error('INSECURE_CONNECTOR_CREDENTIAL_GENERATION_STORE_MODE');
    if (env.SECURITY_MONITORING_MODE !== 'managed') throw new Error('INSECURE_SECURITY_MONITORING_MODE');
    if (env.SECURITY_ALERT_SINK_MODE !== 'managed-security-sink') throw new Error('INSECURE_SECURITY_ALERT_SINK_MODE');
    if (env.SECURITY_LOG_REDACTION_MODE !== 'strict') throw new Error('INSECURE_SECURITY_LOG_REDACTION_MODE');
    if (env.AUDIT_CHAIN_MODE !== 'sha256-v1') throw new Error('INSECURE_AUDIT_CHAIN_MODE');
    if (env.INCIDENT_CORRELATION_MODE !== 'server-generated') throw new Error('INSECURE_INCIDENT_CORRELATION_MODE');
    if (!integerInRange(env.SECURITY_LOG_RETENTION_DAYS,30,3650)) throw new Error('INVALID_SECURITY_LOG_RETENTION_DAYS');
    if (localModes.has(String(env.OBJECT_STORAGE_MODE).toLowerCase())) throw new Error('INSECURE_OBJECT_STORAGE_MODE');
    if (localModes.has(String(env.QUEUE_MODE).toLowerCase())) throw new Error('INSECURE_QUEUE_MODE');
    if (localModes.has(String(env.SESSION_STORE_MODE).toLowerCase())) throw new Error('INSECURE_SESSION_STORE_MODE');
    if (localModes.has(String(env.RATE_LIMIT_MODE).toLowerCase())) throw new Error('INSECURE_RATE_LIMIT_MODE');
    if (localModes.has(String(env.AUDIT_SINK_MODE).toLowerCase())) throw new Error('INSECURE_AUDIT_SINK_MODE');
    if (env.DATABASE_ROLE_MODE !== 'restricted-runtime') throw new Error('INSECURE_DATABASE_ROLE_MODE');
    if (truthy(env.DISABLE_AUTH) || truthy(env.DISABLE_RLS) || truthy(env.ALLOW_CROSS_TENANT) || truthy(env.LOG_RAW_CONTENT)) throw new Error('INSECURE_PRODUCTION_OVERRIDE');
  }

  if (truthy(env.ALLOW_REAL_CLIENT_DATA)) {
    if (nodeEnv !== 'production') throw new Error('REAL_CLIENT_DATA_REQUIRES_PRODUCTION');
    const gates = {
      PRODUCTION_SECURITY_APPROVED: 'true',
      INDEPENDENT_PEN_TEST_STATUS: 'PASS',
      SESSION_REVOCATION_STATUS: 'PASS',
      OIDC_STEP_UP_STATUS: 'PASS',
      SECRETS_KMS_STATUS: 'PASS',
      NETWORK_ISOLATION_STATUS: 'PASS',
      MONITORING_STATUS: 'PASS',
      AUDIT_EXPORT_STATUS: 'PASS',
      BACKUP_ENCRYPTION_STATUS: 'PASS',
      RESTORE_TEST_STATUS: 'PASS',
      MALWARE_SCAN_MODE: 'managed',
      PARSER_ISOLATION_MODE: 'isolated',
      QUARANTINE_STORAGE_MODE: 'isolated',
      DOCUMENT_SECURITY_PIPELINE_STATUS: 'PASS',
      GRAPH_LIVE_VALIDATED: 'true',
      PROCLAIM_LIVE_VALIDATED: 'true',
      CONNECTOR_CREDENTIAL_ROTATION_STATUS: 'PASS',
      CONNECTOR_CREDENTIAL_REVOCATION_STATUS: 'PASS',
      CONNECTOR_SECRET_AUDIT_STATUS: 'PASS',
      CONNECTOR_CREDENTIAL_GENERATION_STORE_STATUS: 'PASS',
      AUDIT_CHAIN_VERIFICATION_STATUS: 'PASS',
      SECURITY_ALERTING_STATUS: 'PASS',
      SESSION_ANOMALY_DETECTION_STATUS: 'PASS',
      EXFILTRATION_DETECTION_STATUS: 'PASS',
      BREAK_GLASS_ALERT_STATUS: 'PASS',
      CONNECTOR_ABUSE_ALERT_STATUS: 'PASS',
      SECURITY_RETENTION_STATUS: 'PASS',
      SECURITY_LOG_REDACTION_STATUS: 'PASS',
    };
    for (const [key,expected] of Object.entries(gates)) if (String(env[key] ?? '') !== expected) throw new Error(`REAL_CLIENT_DATA_GATE_${key}`);
  }

  return { nodeEnv, logLevel: env.LOG_LEVEL ?? 'info', realClientDataAllowed: truthy(env.ALLOW_REAL_CLIENT_DATA) };
}
