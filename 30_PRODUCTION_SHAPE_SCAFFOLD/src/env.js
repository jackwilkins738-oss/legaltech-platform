const allowedEnvironments = new Set(['development','test','staging','production']);

export function validateEnv(env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!allowedEnvironments.has(nodeEnv)) throw new Error('INVALID_NODE_ENV');
  const required = nodeEnv === 'production' ? ['DATABASE_URL'] : [];
  for (const key of required) if (!env[key]) throw new Error(`MISSING_${key}`);
  if (env.DATABASE_URL && /change-me|local-only-change-me/.test(env.DATABASE_URL) && nodeEnv === 'production') {
    throw new Error('INSECURE_PRODUCTION_DATABASE_URL');
  }
  return { nodeEnv, logLevel: env.LOG_LEVEL ?? 'info' };
}
