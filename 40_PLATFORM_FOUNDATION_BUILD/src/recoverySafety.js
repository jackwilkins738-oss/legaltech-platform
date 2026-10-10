import crypto from 'node:crypto';
import {isRestoredArtifactEvidence} from './restoredArtifacts.js';
import {canonicalAuditPayload,auditEntryHash,verifyAuditChainEntries} from './securityMonitoring.js';

const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9._:-]{1,256}$/;
const RESTORE_TARGETS=new Set(['isolated-recovery','staging-recovery','production-recovery']);
const BACKUP_MODES=new Set(['FULL','PITR']);
const STORAGE_MODES=new Set(['IMMUTABLE','WORM','OBJECT_LOCK']);
const safeId=value=>typeof value==='string'&&ID.test(value);
const safeRef=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value)&&/^[A-Za-z0-9._:/@+-]+$/.test(value);
const iso=value=>{if(typeof value!=='string')return NaN;const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:NaN;};
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

function withoutHash(manifest){const {manifestHash,...base}=manifest;return base;}
export function backupManifestHash(manifest){return sha(canonicalAuditPayload(withoutHash(manifest)));}

export function validateBackupManifest(manifest,{tenantId=null,now=Date.now(),maxRpoMs=24*60*60*1000,minImmutabilityMs=7*24*60*60*1000,minimumGeneration=null}={}){
  if(!manifest||typeof manifest!=='object')throw new Error('BACKUP_MANIFEST_INVALID');
  const fields=['version','backupId','tenantId','backupSetId','mode','generation','createdAt','snapshotAt','contentHash','storageMode','immutableUntil','credentialBoundary','keyBoundary','kmsKeyRef','manifestHash'];
  if(Object.getPrototypeOf(manifest)!==Object.prototype||Reflect.ownKeys(manifest).length!==fields.length||fields.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(manifest,k)??{},'value'))||manifest.version!=='v63')throw new Error('BACKUP_MANIFEST_INVALID');
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxRpoMs)||maxRpoMs<1||maxRpoMs>365*86400000||!Number.isSafeInteger(minImmutabilityMs)||minImmutabilityMs<1||minImmutabilityMs>365*86400000||minimumGeneration!==null&&(!Number.isSafeInteger(minimumGeneration)||minimumGeneration<1))throw new Error('BACKUP_POLICY_INVALID');
  for(const key of ['backupId','tenantId','backupSetId','createdAt','snapshotAt','contentHash','manifestHash'])if(!safeId(manifest[key]))throw new Error(`BACKUP_MANIFEST_${key.toUpperCase()}_INVALID`);
  if(!safeRef(manifest.kmsKeyRef))throw new Error('BACKUP_MANIFEST_KMSKEYREF_INVALID');
  if(tenantId!==null&&manifest.tenantId!==tenantId)throw new Error('BACKUP_TENANT_MISMATCH');
  if(!BACKUP_MODES.has(manifest.mode))throw new Error('BACKUP_MODE_INVALID');
  if(!STORAGE_MODES.has(manifest.storageMode))throw new Error('BACKUP_STORAGE_NOT_IMMUTABLE');
  if(manifest.credentialBoundary!=='ISOLATED')throw new Error('BACKUP_CREDENTIAL_BOUNDARY_INVALID');
  if(manifest.keyBoundary!=='SEPARATE_KMS')throw new Error('BACKUP_KEY_BOUNDARY_INVALID');
  if(!Number.isSafeInteger(manifest.generation)||manifest.generation<1)throw new Error('BACKUP_GENERATION_INVALID');
  if(minimumGeneration!==null&&manifest.generation<minimumGeneration)throw new Error('BACKUP_GENERATION_STALE');
  const created=iso(manifest.createdAt),snapshot=iso(manifest.snapshotAt),immutableUntil=iso(manifest.immutableUntil);
  if(!Number.isFinite(created)||!Number.isFinite(snapshot)||!Number.isFinite(immutableUntil))throw new Error('BACKUP_TIMESTAMP_INVALID');
  if(created>now+5*60*1000||snapshot>created||snapshot>now||now-snapshot>maxRpoMs)throw new Error('BACKUP_RPO_INVALID');
  if(immutableUntil-created<minImmutabilityMs||immutableUntil<=now)throw new Error('BACKUP_IMMUTABILITY_WINDOW_INVALID');
  if(!HEX64.test(manifest.contentHash)||!HEX64.test(manifest.manifestHash))throw new Error('BACKUP_HASH_INVALID');
  if(backupManifestHash(manifest)!==manifest.manifestHash)throw new Error('BACKUP_MANIFEST_TAMPERED');
  if(/secret|password|token|credential/i.test(manifest.kmsKeyRef)&&/[= ]/.test(manifest.kmsKeyRef))throw new Error('BACKUP_KEY_REFERENCE_UNSAFE');
  return Object.freeze(structuredClone(manifest));
}

export function createBackupManifest(input){
  const base={version:'v63',backupId:input.backupId,tenantId:input.tenantId,backupSetId:input.backupSetId,mode:input.mode??'PITR',generation:input.generation,createdAt:input.createdAt,snapshotAt:input.snapshotAt,contentHash:input.contentHash,storageMode:input.storageMode??'IMMUTABLE',immutableUntil:input.immutableUntil,credentialBoundary:input.credentialBoundary??'ISOLATED',keyBoundary:input.keyBoundary??'SEPARATE_KMS',kmsKeyRef:input.kmsKeyRef};
  return Object.freeze({...base,manifestHash:backupManifestHash(base)});
}

function restoreId(){return `rst_${crypto.randomUUID()}`;}
function requiredText(value,code,max=512){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(code);return value.trim();}

export class RecoverySafety {
  #store;#now;#allowProductionRestore;#maxRpoMs;#minImmutabilityMs;
  constructor({store,now=()=>Date.now(),allowProductionRestore=false,maxRpoMs=24*60*60*1000,minImmutabilityMs=7*24*60*60*1000}={}){
    if(!store||['recoveryEvidence','recoveryBackupState','recoveryRestoreState','verifyRecoveryEvidenceChain','transaction','audit'].some(k=>typeof store[k]!=='function'))throw new Error('RECOVERY_STORE_REQUIRED');
    if(typeof now!=='function'||typeof allowProductionRestore!=='boolean'||!Number.isSafeInteger(maxRpoMs)||maxRpoMs<1||maxRpoMs>365*86400000||!Number.isSafeInteger(minImmutabilityMs)||minImmutabilityMs<1||minImmutabilityMs>365*86400000)throw new Error('RECOVERY_CONFIGURATION_INVALID');
    this.#store=store;this.#now=now;this.#allowProductionRestore=allowProductionRestore===true;this.#maxRpoMs=maxRpoMs;this.#minImmutabilityMs=minImmutabilityMs;
  }
  #run(tenantId,work){if(!safeId(tenantId))throw new Error('RECOVERY_TENANT_REQUIRED');return this.#store.transaction(()=>{if(!this.#store.verifyRecoveryEvidenceChain(tenantId))throw new Error('RECOVERY_EVIDENCE_CHAIN_INVALID');return work();});}
  recordBackup({manifest,traceId,actorId='backup-service'}){
    return this.#run(manifest?.tenantId,()=>{
      const clean=validateBackupManifest(manifest,{now:this.#now(),maxRpoMs:this.#maxRpoMs,minImmutabilityMs:this.#minImmutabilityMs});
      requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(actorId,'RECOVERY_ACTOR_REQUIRED',256);
      const {existing,highestGeneration}=this.#store.recoveryBackupState(clean.tenantId,clean.backupSetId,clean.backupId);
      if(existing){if(existing.manifestHash!==clean.manifestHash)throw new Error('BACKUP_ID_REUSED');return existing;}
      if(clean.generation<=highestGeneration)throw new Error('BACKUP_GENERATION_NOT_MONOTONIC');
      const item=this.#store.recoveryEvidence({tenantId:clean.tenantId,traceId,actorId,eventType:'BACKUP_VERIFIED',backupId:clean.backupId,backupSetId:clean.backupSetId,generation:clean.generation,manifestHash:clean.manifestHash,contentHash:clean.contentHash,restoreId:null,approverId:null,targetEnvironment:null,outcome:'SUCCESS',reason:'manifest_verified'});
      this.#store.audit({tenantId:clean.tenantId,traceId,actorId,action:'BACKUP_EVIDENCE_VERIFIED',objectId:clean.backupId,outcome:'SUCCESS',reason:'immutable_manifest'});
      return item;
    });
  }
  authorizeRestore({tenantId,manifest,traceId,requesterId,approverId,targetEnvironment='isolated-recovery',reason,stepUpVerified=false}){
    return this.#run(tenantId,()=>{
      requiredText(tenantId,'RECOVERY_TENANT_REQUIRED',256);requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(requesterId,'RECOVERY_REQUESTER_REQUIRED',256);requiredText(approverId,'RECOVERY_APPROVER_REQUIRED',256);requiredText(reason,'RECOVERY_REASON_REQUIRED',512);
      requesterId=requesterId.trim();approverId=approverId.trim();
      if(requesterId===approverId)throw new Error('RESTORE_DUAL_CONTROL_REQUIRED');
      if(!RESTORE_TARGETS.has(targetEnvironment))throw new Error('RESTORE_TARGET_INVALID');
      if(targetEnvironment==='production-recovery'&&(!this.#allowProductionRestore||stepUpVerified!==true))throw new Error('PRODUCTION_RESTORE_NOT_AUTHORIZED');
      const clean=validateBackupManifest(manifest,{tenantId,now:this.#now(),maxRpoMs:this.#maxRpoMs,minImmutabilityMs:this.#minImmutabilityMs});
      const recorded=this.#store.recoveryBackupState(tenantId,clean.backupSetId,clean.backupId).existing;
      if(!recorded||recorded.manifestHash!==clean.manifestHash||recorded.contentHash!==clean.contentHash)throw new Error('RESTORE_BACKUP_EVIDENCE_MISSING');
      const id=restoreId();
      const item=this.#store.recoveryEvidence({tenantId,traceId,actorId:requesterId,approverId,eventType:'RESTORE_AUTHORIZED',backupId:clean.backupId,backupSetId:clean.backupSetId,generation:clean.generation,manifestHash:clean.manifestHash,contentHash:clean.contentHash,restoreId:id,targetEnvironment,outcome:'AUTHORIZED',reason:reason.trim()});
      this.#store.audit({tenantId,traceId,actorId:requesterId,action:'RECOVERY_RESTORE_AUTHORIZED',objectId:id,outcome:'SUCCESS',reason:'dual_control'});
      return Object.freeze({restoreId:id,tenantId,backupId:clean.backupId,manifestHash:clean.manifestHash,targetEnvironment,requesterId,approverId,authorizedAt:item.at});
    });
  }
  beginRestore({authorization,traceId,actorId}){
    return this.#run(authorization?.tenantId,()=>{
      if(!authorization||typeof authorization!=='object')throw new Error('RESTORE_AUTHORIZATION_REQUIRED');
      const keys=['restoreId','tenantId','backupId','manifestHash','targetEnvironment','requesterId','approverId','authorizedAt'];
      if(Object.getPrototypeOf(authorization)!==Object.prototype||Reflect.ownKeys(authorization).length!==keys.length||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(authorization,k)??{},'value')))throw new Error('RESTORE_AUTHORIZATION_UNVERIFIED');
      requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(actorId,'RECOVERY_ACTOR_REQUIRED',256);
      const rows=this.#store.recoveryRestoreState(authorization.tenantId,authorization.restoreId);
      const auth=rows.find(x=>x.eventType==='RESTORE_AUTHORIZED'&&x.restoreId===authorization.restoreId&&x.backupId===authorization.backupId&&x.manifestHash===authorization.manifestHash);
      if(!auth||authorization.targetEnvironment!==auth.targetEnvironment||authorization.requesterId!==auth.actorId||authorization.approverId!==auth.approverId||authorization.authorizedAt!==auth.at)throw new Error('RESTORE_AUTHORIZATION_UNVERIFIED');
      if(rows.some(x=>x.restoreId===authorization.restoreId&&['RESTORE_STARTED','RESTORE_VERIFIED'].includes(x.eventType)))throw new Error('RESTORE_ALREADY_STARTED');
      const item=this.#store.recoveryEvidence({tenantId:authorization.tenantId,traceId,actorId,approverId:auth.approverId,eventType:'RESTORE_STARTED',backupId:auth.backupId,backupSetId:auth.backupSetId,generation:auth.generation,manifestHash:auth.manifestHash,contentHash:auth.contentHash,restoreId:auth.restoreId,targetEnvironment:auth.targetEnvironment,outcome:'STARTED',reason:'authorized_restore'});
      this.#store.audit({tenantId:authorization.tenantId,traceId,actorId,action:'RECOVERY_RESTORE_STARTED',objectId:auth.restoreId,outcome:'SUCCESS',reason:'authorization_verified'});
      return item;
    });
  }
  verifyRestore({tenantId,restoreId:rid,traceId,actorId,restoredContentHash,expectedManifestHash,integrityChecks,artifactEvidence,isolatedTarget}){
    return this.#run(tenantId,()=>{
      for(const [v,c] of [[tenantId,'RECOVERY_TENANT_REQUIRED'],[rid,'RESTORE_ID_REQUIRED'],[traceId,'RECOVERY_TRACE_REQUIRED'],[actorId,'RECOVERY_ACTOR_REQUIRED']])requiredText(v,c,256);
      if(typeof restoredContentHash!=='string'||typeof expectedManifestHash!=='string'||!HEX64.test(restoredContentHash)||!HEX64.test(expectedManifestHash))throw new Error('RESTORE_HASH_INVALID');
      if(isolatedTarget!==true)throw new Error('RESTORE_TARGET_NOT_ISOLATED');
      const checks=['database','auditChain','objectReferences','tenantBoundary','keyAccess','deletions','externalEffects'];
      if(!integrityChecks||Object.getPrototypeOf(integrityChecks)!==Object.prototype||Reflect.ownKeys(integrityChecks).length!==checks.length||checks.some(k=>Object.getOwnPropertyDescriptor(integrityChecks,k)?.value!==true))throw new Error('RESTORE_INTEGRITY_CHECKS_INCOMPLETE');
      const rows=this.#store.recoveryRestoreState(tenantId,rid),started=rows.find(x=>x.eventType==='RESTORE_STARTED'&&x.restoreId===rid);
      if(!started)throw new Error('RESTORE_START_EVIDENCE_MISSING');
      if(started.manifestHash!==expectedManifestHash)throw new Error('RESTORE_MANIFEST_MISMATCH');
      if(!isRestoredArtifactEvidence(artifactEvidence)||artifactEvidence.tenantId!==tenantId||artifactEvidence.backupId!==started.backupId||artifactEvidence.restoreId!==rid||artifactEvidence.targetEnvironment!==started.targetEnvironment||artifactEvidence.backupManifestHash!==expectedManifestHash)throw new Error('RESTORE_ARTIFACT_EVIDENCE_REQUIRED');
      if(restoredContentHash!==started.contentHash||artifactEvidence.contentHash!==started.contentHash)throw new Error('RESTORE_CONTENT_MISMATCH');
      if(rows.some(x=>x.eventType==='RESTORE_VERIFIED'&&x.restoreId===rid))throw new Error('RESTORE_ALREADY_VERIFIED');
      const item=this.#store.recoveryEvidence({tenantId,traceId,actorId,approverId:started.approverId,eventType:'RESTORE_VERIFIED',backupId:started.backupId,backupSetId:started.backupSetId,generation:started.generation,manifestHash:started.manifestHash,restoreId:rid,targetEnvironment:started.targetEnvironment,outcome:'SUCCESS',reason:'integrity_verified',restoredContentHash,artifactCount:artifactEvidence.artifactCount,objectCount:artifactEvidence.objectCount,totalBytes:artifactEvidence.totalBytes});
      this.#store.audit({tenantId,traceId,actorId,action:'RECOVERY_RESTORE_VERIFIED',objectId:rid,outcome:'SUCCESS',reason:'clean_restore_integrity'});
      return item;
    });
  }
}

export function verifyRecoveryEvidenceChain(entries,{genesis='0'.repeat(64)}={}){return verifyAuditChainEntries(entries,{genesis});}
export {auditEntryHash};
