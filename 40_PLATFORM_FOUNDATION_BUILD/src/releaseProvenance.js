import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const SHA256=/^[a-f0-9]{64}$/;
const REVISION=/^[a-f0-9]{40}$/;
const RELEASE_ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const VERSION=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const INSTANCE=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const SAFE_CONFIG_KEYS=Object.freeze([
  'AUTH_MODE','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','OIDC_ALLOWED_DIRECTORY_TENANTS','PUBLIC_ORIGIN','SESSION_ABSOLUTE_TTL_MINUTES','SESSION_IDLE_TTL_MINUTES','SECRET_STORE_MODE','SECRET_STORE_AUTH_MODE',
  'OBJECT_STORAGE_MODE','QUEUE_MODE','SESSION_STORE_MODE','RATE_LIMIT_MODE','AUDIT_SINK_MODE','DATABASE_ROLE_MODE',
  'CONNECTOR_CREDENTIAL_MODE','CONNECTOR_SECRET_CACHE_MODE','GRAPH_CREDENTIAL_SCOPE_MODE','PROCLAIM_CREDENTIAL_SCOPE_MODE',
  'CONNECTOR_CREDENTIAL_GENERATION_STORE_MODE','SECURITY_MONITORING_MODE','SECURITY_ALERT_SINK_MODE','SECURITY_LOG_REDACTION_MODE',
  'AUDIT_CHAIN_MODE','INCIDENT_CORRELATION_MODE','SECURITY_LOG_RETENTION_DAYS','BACKUP_MODE','BACKUP_AUTH_MODE','BACKUP_KEY_MODE','BACKUP_DELETE_PROTECTION_MODE',
  'PITR_MODE','RECOVERY_EVIDENCE_MODE','RANSOMWARE_RECOVERY_MODE','RESTORE_TARGET_MODE','LIVENESS_MODE','READINESS_MODE',
  'READINESS_FAILURE_MODE','READINESS_PROBE_TIMEOUT_MS','MIGRATION_MANIFEST_MODE','MIGRATION_EXECUTION_MODE','DESTRUCTIVE_MIGRATION_MODE','SCHEMA_READINESS_MODE',
  'READ_VOLUME_LIMIT_MODE','DATA_LIFECYCLE_MODE','LEGAL_HOLD_MODE','DISPOSITION_EXECUTION_MODE','DATA_EXPORT_MODE','EXPORT_STORAGE_MODE','EXPORT_DOWNLOAD_GRANT_MODE','EXPORT_PUBLIC_LINK_MODE','EXPORT_EXTERNAL_DELIVERY_MODE','SECURITY_INTERLOCK_MODE','SECURITY_INTERLOCK_RELEASE_MODE','EGRESS_KILL_SWITCH_MODE','PRODUCTION_CHANGE_CONTROL_MODE','CHANGE_APPROVAL_BINDING_MODE','WORKFLOW_PUBLISH_MODE','POLICY_PUBLISH_MODE','FEATURE_FLAG_CHANGE_MODE','WORKER_EXECUTION_AUTH_MODE','WORKER_EXECUTION_BINDING_MODE','WORKER_EXECUTION_REPLAY_MODE','WORKER_EXECUTION_TOKEN_TTL_SECONDS','AUDIT_CHECKPOINT_MODE','AUDIT_ROLLBACK_DETECTION_MODE','AUDIT_CHECKPOINT_EVIDENCE_MODE','DOCUMENT_DELIVERY_MODE','DOCUMENT_DELIVERY_GRANT_MODE','DOCUMENT_DELIVERY_PUBLIC_LINK_MODE','DATA_ENCRYPTION_MODE','DATA_KEY_PROVIDER_MODE','KEY_GENERATION_METADATA_MODE','KEY_ROTATION_MODE','SUPPORT_ACCESS_MODE','SUPPORT_ACCESS_SCOPE_MODE','SUPPORT_ACCESS_AUDIT_MODE','SUPPORT_ACCESS_TTL_SECONDS','GRAPH_WEBHOOK_INGRESS_MODE','GRAPH_WEBHOOK_BASIC_AUTH_MODE','GRAPH_WEBHOOK_RICH_TOKEN_MODE','GRAPH_WEBHOOK_REPLAY_MODE','GRAPH_WEBHOOK_TENANT_MODE','GRAPH_WEBHOOK_VALIDATION_RESPONSE_MODE','GRAPH_SUBSCRIPTION_REGISTRY_MODE','GRAPH_SUBSCRIPTION_SECRET_MODE','GRAPH_SUBSCRIPTION_LIFECYCLE_MODE','GRAPH_SUBSCRIPTION_MUTATION_GUARD_SECONDS','GRAPH_WEBHOOK_QUEUE_MODE','GRAPH_WEBHOOK_WORKER_MODE','GRAPH_WEBHOOK_PAYLOAD_RETENTION_MODE','GRAPH_WEBHOOK_DISPATCH_MODE','GRAPH_DELTA_RECOVERY_MODE','GRAPH_DELTA_CHECKPOINT_MODE','GRAPH_DELTA_URL_MODE','GRAPH_DELTA_DISPATCH_MODE','GRAPH_DELTA_MAX_PAGES_PER_RUN',
]);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function boundedValue(value){if(value===undefined)return '<UNSET>';if(typeof value!=='string'||value.length>512||/[\u0000-\u001f\u007f]/.test(value))throw new Error('PROVENANCE_CONFIG_VALUE_INVALID');return value;}
function safeHash(value,code){if(typeof value!=='string'||!SHA256.test(value))throw new Error(code);return value;}

export function fingerprintSafeConfig(env,{keys=SAFE_CONFIG_KEYS}={}){
  if(!env||typeof env!=='object'||!Array.isArray(keys)||keys.length<1||keys.length>128||new Set(keys).size!==keys.length)throw new Error('PROVENANCE_CONFIG_INVALID');
  const snapshot={};
  for(const key of [...keys].sort()){
    if(typeof key!=='string'||!/^[A-Z0-9_]{1,100}$/.test(key))throw new Error('PROVENANCE_CONFIG_KEY_INVALID');
    snapshot[key]=boundedValue(Object.prototype.hasOwnProperty.call(env,key)?env[key]:undefined);
  }
  return sha(canonicalAuditPayload(snapshot));
}

export function configFingerprintMatches(env,supplied,{keys=SAFE_CONFIG_KEYS}={}){
  if(typeof supplied!=='string'||!SHA256.test(supplied))return false;
  const actual=fingerprintSafeConfig(env,{keys});
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(supplied,'hex'));
}

export function buildReleaseProvenance({releaseId,version,sourceRevision,artifactSha256,migrationManifestSha256,configFingerprint}){
  if(typeof releaseId!=='string'||!RELEASE_ID.test(releaseId))throw new Error('PROVENANCE_RELEASE_ID_INVALID');
  if(typeof version!=='string'||!VERSION.test(version))throw new Error('PROVENANCE_VERSION_INVALID');
  if(typeof sourceRevision!=='string'||!REVISION.test(sourceRevision))throw new Error('PROVENANCE_SOURCE_REVISION_INVALID');
  safeHash(artifactSha256,'PROVENANCE_ARTIFACT_DIGEST_INVALID');safeHash(migrationManifestSha256,'PROVENANCE_MIGRATION_DIGEST_INVALID');safeHash(configFingerprint,'PROVENANCE_CONFIG_DIGEST_INVALID');
  const descriptor=Object.freeze({releaseId,version,sourceRevision,artifactSha256,migrationManifestSha256,configFingerprint});
  return Object.freeze({...descriptor,releaseFingerprint:sha(canonicalAuditPayload(descriptor))});
}

export function releaseMatches(expected,actual){
  try{
    const a=buildReleaseProvenance(expected),b=buildReleaseProvenance(actual);
    return crypto.timingSafeEqual(Buffer.from(a.releaseFingerprint,'hex'),Buffer.from(b.releaseFingerprint,'hex'));
  }catch{return false;}
}

export function createReleaseReadinessProbe({expected,getCurrent}){
  const canonical=buildReleaseProvenance(expected);if(typeof getCurrent!=='function')throw new Error('PROVENANCE_PROVIDER_INVALID');
  return async()=>{
    try{const current=buildReleaseProvenance(await getCurrent());return current.releaseFingerprint===canonical.releaseFingerprint?{ok:true,code:'RELEASE_CURRENT'}:{ok:false,code:'RELEASE_DRIFT'};}
    catch{return {ok:false,code:'RELEASE_PROVENANCE_INVALID'};}
  };
}

export function assessFleetProvenance(instances){
  if(!Array.isArray(instances)||instances.length<1||instances.length>1000)throw new Error('PROVENANCE_FLEET_INVALID');
  const release=new Set(),config=new Set();
  for(const row of instances){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['instanceId','releaseFingerprint','configFingerprint'].includes(k))||typeof row.instanceId!=='string'||!INSTANCE.test(row.instanceId))throw new Error('PROVENANCE_INSTANCE_INVALID');
    release.add(safeHash(row.releaseFingerprint,'PROVENANCE_RELEASE_FINGERPRINT_INVALID'));config.add(safeHash(row.configFingerprint,'PROVENANCE_CONFIG_DIGEST_INVALID'));
  }
  const status=release.size>1?'MIXED_RELEASE':config.size>1?'CONFIG_DRIFT':'CONSISTENT';
  return Object.freeze({status,instanceCount:instances.length,releaseVariants:release.size,configVariants:config.size});
}
