export function nextRetryDelayMs(attempt, { baseMs = 1000, maxMs = 300000 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('INVALID_ATTEMPT');
  return Math.min(baseMs * (2 ** (attempt - 1)), maxMs);
}

export function failureTransition(job, { retryable, errorCode, now = Date.now() }) {
  const attempts = job.attempts + 1;
  if (!retryable || attempts >= job.maxAttempts) {
    return { ...job, attempts, status: 'DEAD_LETTER', lastErrorCode: errorCode, leaseOwner: null, leaseUntil: null };
  }
  return {
    ...job, attempts, status: 'RETRY_WAIT', lastErrorCode: errorCode,
    availableAt: new Date(now + nextRetryDelayMs(attempts)).toISOString(), leaseOwner: null, leaseUntil: null
  };
}

export function assertJobTenant(job, expectedTenantId) {
  if (job.tenantId !== expectedTenantId) throw new Error('TENANT_MISMATCH');
}
