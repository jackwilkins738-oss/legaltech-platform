const allowedEnvironments = new Set(['development','test','staging','production']);
const secureStores = new Set(['managed','key-vault','secrets-manager','secret-manager']);
const localModes = new Set(['local','mock','memory','filesystem','sqlite']);
const truthy = value => String(value ?? '').toLowerCase() === 'true';

function httpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function validateEnv(env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!allowedEnvironments.has(nodeEnv)) throw new Error('INVALID_NODE_ENV');
  if (env.DATABASE_URL && /change-me|local-only-change-me/.test(env.DATABASE_URL) && nodeEnv === 'production') throw new Error('INSECURE_PRODUCTION_DATABASE_URL');

  if (nodeEnv === 'production') {
    const required = ['DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','SECRET_STORE_MODE','OBJECT_STORAGE_MODE','QUEUE_MODE','SESSION_STORE_MODE','RATE_LIMIT_MODE','AUDIT_SINK_MODE','DATABASE_ROLE_MODE'];
    for (const key of required) if (!env[key]) throw new Error(`MISSING_${key}`);
    if (env.AUTH_MODE !== 'oidc') throw new Error('INSECURE_PRODUCTION_AUTH_MODE');
    if (!httpsUrl(env.OIDC_ISSUER)) throw new Error('INSECURE_OIDC_ISSUER');
    if (!secureStores.has(env.SECRET_STORE_MODE)) throw new Error('INSECURE_SECRET_STORE_MODE');
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
      GRAPH_LIVE_VALIDATED: 'true',
      PROCLAIM_LIVE_VALIDATED: 'true',
    };
    for (const [key,expected] of Object.entries(gates)) if (String(env[key] ?? '') !== expected) throw new Error(`REAL_CLIENT_DATA_GATE_${key}`);
  }

  return { nodeEnv, logLevel: env.LOG_LEVEL ?? 'info', realClientDataAllowed: truthy(env.ALLOW_REAL_CLIENT_DATA) };
}
