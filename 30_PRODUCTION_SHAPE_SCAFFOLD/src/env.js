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
    const required = ['DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','OIDC_ALLOWED_DIRECTORY_TENANTS','PUBLIC_ORIGIN','SESSION_ABSOLUTE_TTL_MINUTES','SESSION_IDLE_TTL_MINUTES','SECRET_STORE_MODE','OBJECT_STORAGE_MODE','QUEUE_MODE','SESSION_STORE_MODE','RATE_LIMIT_MODE','AUDIT_SINK_MODE','DATABASE_ROLE_MODE','SECRET_STORE_AUTH_MODE','CONNECTOR_CREDENTIAL_MODE','CONNECTOR_SECRET_CACHE_MODE','GRAPH_CREDENTIAL_SCOPE_MODE','PROCLAIM_CREDENTIAL_SCOPE_MODE','CONNECTOR_CREDENTIAL_GENERATION_STORE_MODE','SECURITY_MONITORING_MODE','SECURITY_ALERT_SINK_MODE','SECURITY_LOG_REDACTION_MODE','AUDIT_CHAIN_MODE','INCIDENT_CORRELATION_MODE','SECURITY_LOG_RETENTION_DAYS','BACKUP_MODE','BACKUP_AUTH_MODE','BACKUP_KEY_MODE','BACKUP_DELETE_PROTECTION_MODE','PITR_MODE','RECOVERY_EVIDENCE_MODE','RANSOMWARE_RECOVERY_MODE','RESTORE_TARGET_MODE','LIVENESS_MODE','READINESS_MODE','READINESS_FAILURE_MODE','READINESS_PROBE_TIMEOUT_MS','MIGRATION_MANIFEST_MODE','MIGRATION_EXECUTION_MODE','DESTRUCTIVE_MIGRATION_MODE','SCHEMA_READINESS_MODE','READ_VOLUME_LIMIT_MODE','DATA_LIFECYCLE_MODE','LEGAL_HOLD_MODE','DISPOSITION_EXECUTION_MODE','RELEASE_PROVENANCE_MODE','CONFIG_FINGERPRINT_MODE','RELEASE_ID','SOURCE_REVISION','ARTIFACT_SHA256','MIGRATION_MANIFEST_SHA256','CONFIG_FINGERPRINT_SHA256','DATA_EXPORT_MODE','EXPORT_STORAGE_MODE','EXPORT_DOWNLOAD_GRANT_MODE','EXPORT_PUBLIC_LINK_MODE','EXPORT_EXTERNAL_DELIVERY_MODE','SECURITY_INTERLOCK_MODE','SECURITY_INTERLOCK_RELEASE_MODE','EGRESS_KILL_SWITCH_MODE','PRODUCTION_CHANGE_CONTROL_MODE','CHANGE_APPROVAL_BINDING_MODE','WORKFLOW_PUBLISH_MODE','POLICY_PUBLISH_MODE','FEATURE_FLAG_CHANGE_MODE','WORKER_EXECUTION_AUTH_MODE','WORKER_EXECUTION_BINDING_MODE','WORKER_EXECUTION_REPLAY_MODE','WORKER_EXECUTION_TOKEN_TTL_SECONDS','AUDIT_CHECKPOINT_MODE','AUDIT_ROLLBACK_DETECTION_MODE','AUDIT_CHECKPOINT_EVIDENCE_MODE','DOCUMENT_DELIVERY_MODE','DOCUMENT_DELIVERY_GRANT_MODE','DOCUMENT_DELIVERY_PUBLIC_LINK_MODE','DATA_ENCRYPTION_MODE','DATA_KEY_PROVIDER_MODE','KEY_GENERATION_METADATA_MODE','KEY_ROTATION_MODE','INCIDENT_RESPONSE_MODE','INCIDENT_EVIDENCE_MODE','INCIDENT_CLOSE_MODE','TENANT_CONFIG_MODE','TENANT_CONFIG_ROLLOUT_MODE','WORKFLOW_SIMULATION_MODE','WORKFLOW_SIMULATION_DATA_MODE','TENANT_CONFIG_VALIDATION_MODE','TENANT_CONFIG_VALIDATION_EVIDENCE_MODE','SBOM_MODE','BUILD_PROVENANCE_MODE','ARTIFACT_ATTESTATION_MODE','VULNERABILITY_EVIDENCE_MODE','VULNERABILITY_RELEASE_GATE_MODE','VEX_OVERRIDE_MODE','DEAD_LETTER_RECOVERY_MODE','DEAD_LETTER_HIGH_RISK_MODE','DEAD_LETTER_RETRY_BUDGET_MODE','EGRESS_POLICY_MODE','EGRESS_DNS_MODE','EGRESS_REDIRECT_MODE','DEPENDENCY_PROTECTION_MODE','DEPENDENCY_PROTECTION_STORE_MODE','DEPENDENCY_CONCURRENCY_MODE','DEPENDENCY_RETRY_JITTER_MODE','DEPLOYMENT_DRAIN_MODE','DEPLOYMENT_DRAIN_READINESS_MODE','DEPLOYMENT_DRAIN_SHUTDOWN_MODE'];
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
    if (env.BACKUP_MODE !== 'immutable-managed') throw new Error('INSECURE_BACKUP_MODE');
    if (!workloadIdentityModes.has(env.BACKUP_AUTH_MODE)) throw new Error('INSECURE_BACKUP_AUTH_MODE');
    if (env.BACKUP_KEY_MODE !== 'separate-kms') throw new Error('INSECURE_BACKUP_KEY_MODE');
    if (env.BACKUP_DELETE_PROTECTION_MODE !== 'two-person') throw new Error('INSECURE_BACKUP_DELETE_PROTECTION_MODE');
    if (env.PITR_MODE !== 'enabled') throw new Error('INSECURE_PITR_MODE');
    if (env.RECOVERY_EVIDENCE_MODE !== 'durable-append-only') throw new Error('INSECURE_RECOVERY_EVIDENCE_MODE');
    if (env.RANSOMWARE_RECOVERY_MODE !== 'isolated-restore') throw new Error('INSECURE_RANSOMWARE_RECOVERY_MODE');
    if (env.RESTORE_TARGET_MODE !== 'clean-environment') throw new Error('INSECURE_RESTORE_TARGET_MODE');
    if (env.LIVENESS_MODE !== 'process-only') throw new Error('INSECURE_LIVENESS_MODE');
    if (env.READINESS_MODE !== 'dependency-aware') throw new Error('INSECURE_READINESS_MODE');
    if (env.READINESS_FAILURE_MODE !== 'fail-closed') throw new Error('INSECURE_READINESS_FAILURE_MODE');
    if (!integerInRange(env.READINESS_PROBE_TIMEOUT_MS,100,5000)) throw new Error('INVALID_READINESS_PROBE_TIMEOUT_MS');
    if (env.MIGRATION_MANIFEST_MODE !== 'hash-pinned') throw new Error('INSECURE_MIGRATION_MANIFEST_MODE');
    if (env.MIGRATION_EXECUTION_MODE !== 'external-controlled') throw new Error('INSECURE_MIGRATION_EXECUTION_MODE');
    if (env.DESTRUCTIVE_MIGRATION_MODE !== 'review-required') throw new Error('INSECURE_DESTRUCTIVE_MIGRATION_MODE');
    if (env.SCHEMA_READINESS_MODE !== 'required') throw new Error('INSECURE_SCHEMA_READINESS_MODE');
    if (env.READ_VOLUME_LIMIT_MODE !== 'managed') throw new Error('INSECURE_READ_VOLUME_LIMIT_MODE');
    if (env.DATA_LIFECYCLE_MODE !== 'policy-versioned') throw new Error('INSECURE_DATA_LIFECYCLE_MODE');
    if (env.LEGAL_HOLD_MODE !== 'fail-closed') throw new Error('INSECURE_LEGAL_HOLD_MODE');
    if (env.DISPOSITION_EXECUTION_MODE !== 'external-controlled') throw new Error('INSECURE_DISPOSITION_EXECUTION_MODE');
    if (env.RELEASE_PROVENANCE_MODE !== 'verified') throw new Error('INSECURE_RELEASE_PROVENANCE_MODE');
    if (env.CONFIG_FINGERPRINT_MODE !== 'safe-allowlist') throw new Error('INSECURE_CONFIG_FINGERPRINT_MODE');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(env.RELEASE_ID)) throw new Error('INVALID_RELEASE_ID');
    if (!/^[a-f0-9]{40}$/.test(env.SOURCE_REVISION)) throw new Error('INVALID_SOURCE_REVISION');
    if (!/^[a-f0-9]{64}$/.test(env.ARTIFACT_SHA256)) throw new Error('INVALID_ARTIFACT_SHA256');
    if (!/^[a-f0-9]{64}$/.test(env.MIGRATION_MANIFEST_SHA256)) throw new Error('INVALID_MIGRATION_MANIFEST_SHA256');
    if (!/^[a-f0-9]{64}$/.test(env.CONFIG_FINGERPRINT_SHA256)) throw new Error('INVALID_CONFIG_FINGERPRINT_SHA256');
    if (env.DATA_EXPORT_MODE !== 'controlled-internal') throw new Error('INSECURE_DATA_EXPORT_MODE');
    if (env.EXPORT_STORAGE_MODE !== 'isolated-managed') throw new Error('INSECURE_EXPORT_STORAGE_MODE');
    if (env.EXPORT_DOWNLOAD_GRANT_MODE !== 'actor-bound-single-use') throw new Error('INSECURE_EXPORT_DOWNLOAD_GRANT_MODE');
    if (env.EXPORT_PUBLIC_LINK_MODE !== 'disabled') throw new Error('INSECURE_EXPORT_PUBLIC_LINK_MODE');
    if (env.EXPORT_EXTERNAL_DELIVERY_MODE !== 'disabled') throw new Error('INSECURE_EXPORT_EXTERNAL_DELIVERY_MODE');
    if (env.SECURITY_INTERLOCK_MODE !== 'managed-fail-closed') throw new Error('INSECURE_SECURITY_INTERLOCK_MODE');
    if (env.SECURITY_INTERLOCK_RELEASE_MODE !== 'dual-control') throw new Error('INSECURE_SECURITY_INTERLOCK_RELEASE_MODE');
    if (env.EGRESS_KILL_SWITCH_MODE !== 'required') throw new Error('INSECURE_EGRESS_KILL_SWITCH_MODE');
    if (env.PRODUCTION_CHANGE_CONTROL_MODE !== 'dual-control') throw new Error('INSECURE_PRODUCTION_CHANGE_CONTROL_MODE');
    if (env.CHANGE_APPROVAL_BINDING_MODE !== 'hash-bound-single-use') throw new Error('INSECURE_CHANGE_APPROVAL_BINDING_MODE');
    if (env.WORKFLOW_PUBLISH_MODE !== 'approved') throw new Error('INSECURE_WORKFLOW_PUBLISH_MODE');
    if (env.POLICY_PUBLISH_MODE !== 'approved') throw new Error('INSECURE_POLICY_PUBLISH_MODE');
    if (env.FEATURE_FLAG_CHANGE_MODE !== 'approved') throw new Error('INSECURE_FEATURE_FLAG_CHANGE_MODE');
    if (env.WORKER_EXECUTION_AUTH_MODE !== 'managed-workload') throw new Error('INSECURE_WORKER_EXECUTION_AUTH_MODE');
    if (env.WORKER_EXECUTION_BINDING_MODE !== 'tenant-type-object-trace') throw new Error('INSECURE_WORKER_EXECUTION_BINDING_MODE');
    if (env.WORKER_EXECUTION_REPLAY_MODE !== 'durable-single-use') throw new Error('INSECURE_WORKER_EXECUTION_REPLAY_MODE');
    if (!integerInRange(env.WORKER_EXECUTION_TOKEN_TTL_SECONDS,5,120)) throw new Error('INVALID_WORKER_EXECUTION_TOKEN_TTL_SECONDS');
    if (env.AUDIT_CHECKPOINT_MODE !== 'external-immutable') throw new Error('INSECURE_AUDIT_CHECKPOINT_MODE');
    if (env.AUDIT_ROLLBACK_DETECTION_MODE !== 'required') throw new Error('INSECURE_AUDIT_ROLLBACK_DETECTION_MODE');
    if (env.AUDIT_CHECKPOINT_EVIDENCE_MODE !== 'append-only') throw new Error('INSECURE_AUDIT_CHECKPOINT_EVIDENCE_MODE');
    if (env.DOCUMENT_DELIVERY_MODE !== 'server-resolved') throw new Error('INSECURE_DOCUMENT_DELIVERY_MODE');
    if (env.DOCUMENT_DELIVERY_GRANT_MODE !== 'actor-matter-single-use') throw new Error('INSECURE_DOCUMENT_DELIVERY_GRANT_MODE');
    if (env.DOCUMENT_DELIVERY_PUBLIC_LINK_MODE !== 'disabled') throw new Error('INSECURE_DOCUMENT_DELIVERY_PUBLIC_LINK_MODE');
    if (env.DATA_ENCRYPTION_MODE !== 'envelope-managed') throw new Error('INSECURE_DATA_ENCRYPTION_MODE');
    if (env.DATA_KEY_PROVIDER_MODE !== 'managed-kms') throw new Error('INSECURE_DATA_KEY_PROVIDER_MODE');
    if (env.KEY_GENERATION_METADATA_MODE !== 'durable') throw new Error('INSECURE_KEY_GENERATION_METADATA_MODE');
    if (env.KEY_ROTATION_MODE !== 'generation-pinned') throw new Error('INSECURE_KEY_ROTATION_MODE');
    if (env.SUPPORT_ACCESS_MODE !== 'jit-dual-control') throw new Error('INSECURE_SUPPORT_ACCESS_MODE');
    if (env.SUPPORT_ACCESS_SCOPE_MODE !== 'resource-bound') throw new Error('INSECURE_SUPPORT_ACCESS_SCOPE_MODE');
    if (env.SUPPORT_ACCESS_AUDIT_MODE !== 'append-only') throw new Error('INSECURE_SUPPORT_ACCESS_AUDIT_MODE');
    if (!integerInRange(env.SUPPORT_ACCESS_TTL_SECONDS,60,900)) throw new Error('INVALID_SUPPORT_ACCESS_TTL_SECONDS');
    if (env.GRAPH_WEBHOOK_INGRESS_MODE !== 'queued-validate-before-dispatch') throw new Error('INSECURE_GRAPH_WEBHOOK_INGRESS_MODE');
    if (env.GRAPH_WEBHOOK_BASIC_AUTH_MODE !== 'subscription-client-state') throw new Error('INSECURE_GRAPH_WEBHOOK_BASIC_AUTH_MODE');
    if (env.GRAPH_WEBHOOK_RICH_TOKEN_MODE !== 'verified') throw new Error('INSECURE_GRAPH_WEBHOOK_RICH_TOKEN_MODE');
    if (env.GRAPH_WEBHOOK_REPLAY_MODE !== 'durable-fingerprint') throw new Error('INSECURE_GRAPH_WEBHOOK_REPLAY_MODE');
    if (env.GRAPH_WEBHOOK_TENANT_MODE !== 'server-subscription') throw new Error('INSECURE_GRAPH_WEBHOOK_TENANT_MODE');
    if (env.GRAPH_WEBHOOK_VALIDATION_RESPONSE_MODE !== 'opaque-plain-text') throw new Error('INSECURE_GRAPH_WEBHOOK_VALIDATION_RESPONSE_MODE');
    if (env.GRAPH_SUBSCRIPTION_REGISTRY_MODE !== 'durable-server-owned') throw new Error('INSECURE_GRAPH_SUBSCRIPTION_REGISTRY_MODE');
    if (env.GRAPH_SUBSCRIPTION_SECRET_MODE !== 'managed-reference') throw new Error('INSECURE_GRAPH_SUBSCRIPTION_SECRET_MODE');
    if (env.GRAPH_SUBSCRIPTION_LIFECYCLE_MODE !== 'renew-reauth-recovery') throw new Error('INSECURE_GRAPH_SUBSCRIPTION_LIFECYCLE_MODE');
    if (!integerInRange(env.GRAPH_SUBSCRIPTION_MUTATION_GUARD_SECONDS,600,3600)) throw new Error('INVALID_GRAPH_SUBSCRIPTION_MUTATION_GUARD_SECONDS');
    if (env.GRAPH_WEBHOOK_QUEUE_MODE !== 'managed-isolated') throw new Error('INSECURE_GRAPH_WEBHOOK_QUEUE_MODE');
    if (env.GRAPH_WEBHOOK_WORKER_MODE !== 'workload-identity') throw new Error('INSECURE_GRAPH_WEBHOOK_WORKER_MODE');
    if (env.GRAPH_WEBHOOK_PAYLOAD_RETENTION_MODE !== 'ephemeral') throw new Error('INSECURE_GRAPH_WEBHOOK_PAYLOAD_RETENTION_MODE');
    if (env.GRAPH_WEBHOOK_DISPATCH_MODE !== 'idempotent-fingerprint') throw new Error('INSECURE_GRAPH_WEBHOOK_DISPATCH_MODE');
    if (env.GRAPH_DELTA_RECOVERY_MODE !== 'managed-bounded') throw new Error('INSECURE_GRAPH_DELTA_RECOVERY_MODE');
    if (env.GRAPH_DELTA_CHECKPOINT_MODE !== 'managed-secret-reference') throw new Error('INSECURE_GRAPH_DELTA_CHECKPOINT_MODE');
    if (env.GRAPH_DELTA_URL_MODE !== 'graph-v1-origin-pinned') throw new Error('INSECURE_GRAPH_DELTA_URL_MODE');
    if (env.GRAPH_DELTA_DISPATCH_MODE !== 'idempotent') throw new Error('INSECURE_GRAPH_DELTA_DISPATCH_MODE');
    if (!integerInRange(env.GRAPH_DELTA_MAX_PAGES_PER_RUN,1,100)) throw new Error('INVALID_GRAPH_DELTA_MAX_PAGES_PER_RUN');
    if (env.INCIDENT_RESPONSE_MODE !== 'managed-evidence') throw new Error('INSECURE_INCIDENT_RESPONSE_MODE');
    if (env.INCIDENT_EVIDENCE_MODE !== 'hash-reference-only') throw new Error('INSECURE_INCIDENT_EVIDENCE_MODE');
    if (env.INCIDENT_CLOSE_MODE !== 'dual-control') throw new Error('INSECURE_INCIDENT_CLOSE_MODE');
    if (env.TENANT_CONFIG_MODE !== 'versioned-hash-bound') throw new Error('INSECURE_TENANT_CONFIG_MODE');
    if (env.TENANT_CONFIG_ROLLOUT_MODE !== 'approved-atomic') throw new Error('INSECURE_TENANT_CONFIG_ROLLOUT_MODE');
    if (env.WORKFLOW_SIMULATION_MODE !== 'isolated-no-side-effects') throw new Error('INSECURE_WORKFLOW_SIMULATION_MODE');
    if (env.WORKFLOW_SIMULATION_DATA_MODE !== 'synthetic-only') throw new Error('INSECURE_WORKFLOW_SIMULATION_DATA_MODE');
    if (env.TENANT_CONFIG_VALIDATION_MODE !== 'synthetic-suite-required') throw new Error('INSECURE_TENANT_CONFIG_VALIDATION_MODE');
    if (env.TENANT_CONFIG_VALIDATION_EVIDENCE_MODE !== 'append-only-hash-bound') throw new Error('INSECURE_TENANT_CONFIG_VALIDATION_EVIDENCE_MODE');
    if (env.SBOM_MODE !== 'cyclonedx-1.7') throw new Error('INSECURE_SBOM_MODE');
    if (env.BUILD_PROVENANCE_MODE !== 'slsa-v1.2') throw new Error('INSECURE_BUILD_PROVENANCE_MODE');
    if (env.ARTIFACT_ATTESTATION_MODE !== 'verified-external') throw new Error('INSECURE_ARTIFACT_ATTESTATION_MODE');
    if (env.VULNERABILITY_EVIDENCE_MODE !== 'sbom-bound-external') throw new Error('INSECURE_VULNERABILITY_EVIDENCE_MODE');
    if (env.VULNERABILITY_RELEASE_GATE_MODE !== 'critical-high-blocking') throw new Error('INSECURE_VULNERABILITY_RELEASE_GATE_MODE');
    if (env.VEX_OVERRIDE_MODE !== 'reviewed-signed') throw new Error('INSECURE_VEX_OVERRIDE_MODE');
    if (env.DEAD_LETTER_RECOVERY_MODE !== 'exact-job') throw new Error('INSECURE_DEAD_LETTER_RECOVERY_MODE');
    if (env.DEAD_LETTER_HIGH_RISK_MODE !== 'dual-control') throw new Error('INSECURE_DEAD_LETTER_HIGH_RISK_MODE');
    if (env.DEAD_LETTER_RETRY_BUDGET_MODE !== 'preserve-attempts') throw new Error('INSECURE_DEAD_LETTER_RETRY_BUDGET_MODE');
    if (env.EGRESS_POLICY_MODE !== 'destination-allowlist') throw new Error('INSECURE_EGRESS_POLICY_MODE');
    if (env.EGRESS_DNS_MODE !== 'resolve-and-pin') throw new Error('INSECURE_EGRESS_DNS_MODE');
    if (env.EGRESS_REDIRECT_MODE !== 'disabled') throw new Error('INSECURE_EGRESS_REDIRECT_MODE');
    if (env.DEPENDENCY_PROTECTION_MODE !== 'tenant-scoped-circuit-breaker') throw new Error('INSECURE_DEPENDENCY_PROTECTION_MODE');
    if (env.DEPENDENCY_PROTECTION_STORE_MODE !== 'managed-shared') throw new Error('INSECURE_DEPENDENCY_PROTECTION_STORE_MODE');
    if (env.DEPENDENCY_CONCURRENCY_MODE !== 'bounded') throw new Error('INSECURE_DEPENDENCY_CONCURRENCY_MODE');
    if (env.DEPENDENCY_RETRY_JITTER_MODE !== 'full-jitter') throw new Error('INSECURE_DEPENDENCY_RETRY_JITTER_MODE');
    if (env.DEPLOYMENT_DRAIN_MODE !== 'managed-shared') throw new Error('INSECURE_DEPLOYMENT_DRAIN_MODE');
    if (env.DEPLOYMENT_DRAIN_READINESS_MODE !== 'unready') throw new Error('INSECURE_DEPLOYMENT_DRAIN_READINESS_MODE');
    if (env.DEPLOYMENT_DRAIN_SHUTDOWN_MODE !== 'bounded-graceful') throw new Error('INSECURE_DEPLOYMENT_DRAIN_SHUTDOWN_MODE');
    if (env.TENANT_LIFECYCLE_MODE !== 'managed-state-machine') throw new Error('INSECURE_TENANT_LIFECYCLE_MODE');
    if (env.TENANT_OFFBOARDING_MODE !== 'evidence-gated-no-auto-delete') throw new Error('INSECURE_TENANT_OFFBOARDING_MODE');
    if (env.ACCESS_REVIEW_MODE !== 'hash-snapshot-dual-control') throw new Error('INSECURE_ACCESS_REVIEW_MODE');
    if (env.ACCESS_REVIEW_ACTION_MODE !== 'explicit-revocation') throw new Error('INSECURE_ACCESS_REVIEW_ACTION_MODE');
    if (env.DATA_CLASSIFICATION_MODE !== 'explicit-field') throw new Error('INSECURE_DATA_CLASSIFICATION_MODE');
    if (env.UNCLASSIFIED_DATA_MODE !== 'deny') throw new Error('INSECURE_UNCLASSIFIED_DATA_MODE');
    if (env.RESTRICTED_EGRESS_MODE !== 'policy-enforced') throw new Error('INSECURE_RESTRICTED_EGRESS_MODE');
    if (env.TENANT_QUOTA_MODE !== 'managed-shared-admission') throw new Error('INSECURE_TENANT_QUOTA_MODE');
    if (env.TENANT_QUOTA_POLICY_MODE !== 'server-configured-no-default') throw new Error('INSECURE_TENANT_QUOTA_POLICY_MODE');
    if (env.SLO_MODE !== 'managed-aggregate') throw new Error('INSECURE_SLO_MODE');
    if (env.SLO_DATA_MODE !== 'metrics-only') throw new Error('INSECURE_SLO_DATA_MODE');
    if (env.SLO_ALERT_MODE !== 'intent-only') throw new Error('INSECURE_SLO_ALERT_MODE');
    if (env.DATA_RESIDENCY_MODE !== 'tenant-pinned-allowlist') throw new Error('INSECURE_DATA_RESIDENCY_MODE');
    if (env.CROSS_REGION_REPLICATION_MODE !== 'policy-controlled') throw new Error('INSECURE_CROSS_REGION_REPLICATION_MODE');
    if (env.RESIDENCY_EVIDENCE_MODE !== 'provider-hash-bound') throw new Error('INSECURE_RESIDENCY_EVIDENCE_MODE');
    if (env.ONBOARDING_READINESS_MODE !== 'required-control-set') throw new Error('INSECURE_ONBOARDING_READINESS_MODE');
    if (env.TENANT_ACTIVATION_MODE !== 'readiness-hash-bound') throw new Error('INSECURE_TENANT_ACTIVATION_MODE');
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
      BACKUP_IMMUTABILITY_STATUS: 'PASS',
      PITR_STATUS: 'PASS',
      BACKUP_CREDENTIAL_ISOLATION_STATUS: 'PASS',
      BACKUP_KEY_SEPARATION_STATUS: 'PASS',
      RESTORE_INTEGRITY_STATUS: 'PASS',
      RESTORE_DUAL_CONTROL_STATUS: 'PASS',
      RANSOMWARE_RECOVERY_DRILL_STATUS: 'PASS',
      RETENTION_POLICY_REVIEW_STATUS: 'PASS',
      LEGAL_HOLD_VALIDATION_STATUS: 'PASS',
      DATA_DISPOSITION_PROCEDURE_STATUS: 'PASS',
      RELEASE_PROVENANCE_STATUS: 'PASS',
      CONFIG_DRIFT_MONITORING_STATUS: 'PASS',
      DATA_EXPORT_SECURITY_REVIEW_STATUS: 'PASS',
      EXPORT_STORAGE_VALIDATION_STATUS: 'PASS',
      SECURITY_INTERLOCK_DRILL_STATUS: 'PASS',
      EGRESS_KILL_SWITCH_VALIDATION_STATUS: 'PASS',
      CHANGE_CONTROL_VALIDATION_STATUS: 'PASS',
      WORKFLOW_POLICY_APPROVAL_STATUS: 'PASS',
      WORKER_EXECUTION_VALIDATION_STATUS: 'PASS',
      AUDIT_CHECKPOINT_VALIDATION_STATUS: 'PASS',
      DOCUMENT_DELIVERY_VALIDATION_STATUS: 'PASS',
      ENCRYPTION_KEY_LIFECYCLE_VALIDATION_STATUS: 'PASS',
      SUPPORT_ACCESS_VALIDATION_STATUS: 'PASS',
      GRAPH_WEBHOOK_VALIDATION_STATUS: 'PASS',
      GRAPH_SUBSCRIPTION_LIFECYCLE_VALIDATION_STATUS: 'PASS',
      GRAPH_WEBHOOK_QUEUE_VALIDATION_STATUS: 'PASS',
      GRAPH_DELTA_RECOVERY_VALIDATION_STATUS: 'PASS',
      INCIDENT_RESPONSE_VALIDATION_STATUS: 'PASS',
      TENANT_CONFIG_VALIDATION_STATUS: 'PASS',
      WORKFLOW_SIMULATION_VALIDATION_STATUS: 'PASS',
      TENANT_CONFIG_REGRESSION_STATUS: 'PASS',
      SBOM_VALIDATION_STATUS: 'PASS',
      BUILD_PROVENANCE_VALIDATION_STATUS: 'PASS',
      VULNERABILITY_SCANNING_STATUS: 'PASS',
      VEX_REVIEW_STATUS: 'PASS',
      DEAD_LETTER_RECOVERY_VALIDATION_STATUS: 'PASS',
      EGRESS_POLICY_VALIDATION_STATUS: 'PASS',
      DEPENDENCY_PROTECTION_VALIDATION_STATUS: 'PASS',
      DEPLOYMENT_DRAIN_VALIDATION_STATUS: 'PASS',
      TENANT_LIFECYCLE_VALIDATION_STATUS: 'PASS',
      ACCESS_REVIEW_VALIDATION_STATUS: 'PASS',
      DATA_CLASSIFICATION_VALIDATION_STATUS: 'PASS',
      TENANT_QUOTA_VALIDATION_STATUS: 'PASS',
      SLO_VALIDATION_STATUS: 'PASS',
      DATA_RESIDENCY_VALIDATION_STATUS: 'PASS',
      ONBOARDING_READINESS_VALIDATION_STATUS: 'PASS',
    };
    for (const [key,expected] of Object.entries(gates)) if (String(env[key] ?? '') !== expected) throw new Error(`REAL_CLIENT_DATA_GATE_${key}`);
  }

  return { nodeEnv, logLevel: env.LOG_LEVEL ?? 'info', realClientDataAllowed: truthy(env.ALLOW_REAL_CLIENT_DATA) };
}
