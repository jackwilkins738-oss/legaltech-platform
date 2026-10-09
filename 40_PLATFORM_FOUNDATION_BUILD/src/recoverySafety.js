import crypto from 'node:crypto';
import {canonicalAuditPayload,auditEntryHash,verifyAuditChainEntries} from './securityMonitoring.js';

const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9._:-]{1,256}$/;
const RESTORE_TARGETS=new Set(['isolated-recovery','staging-recovery','production-recovery']);
const BACKUP_MODES=new Set(['FULL','PITR']);
const STORAGE_MODES=new Set(['IMMUTABLE','WORM','OBJECT_LOCK']);
const safeId=value=>typeof value==='string'&&ID.test(value);
const safeRef=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value)&&/^[A-Za-z0-9._:/@+-]+$/.test(value);
const iso=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:NaN;};
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

function withoutHash(manifest){const {manifestHash,...base}=manifest;return base;}
export function backupManifestHash(manifest){return sha(canonicalAuditPayload(withoutHash(manifest)));}

export function validateBackupManifest(manifest,{tenantId=null,now=Date.now(),maxRpoMs=24*60*60*1000,minImmutabilityMs=7*24*60*60*1000,minimumGeneration=null}={}){
  if(!manifest||typeof manifest!=='object')throw new Error('BACKUP_MANIFEST_INVALID');
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
  if(created>now+5*60*1000||snapshot>created||now-snapshot>maxRpoMs)throw new Error('BACKUP_RPO_INVALID');
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
    if(!store||typeof store.recoveryEvidence!=='function'||typeof store.listRecoveryEvidence!=='function')throw new Error('RECOVERY_STORE_REQUIRED');
    this.#store=store;this.#now=now;this.#allowProductionRestore=allowProductionRestore===true;this.#maxRpoMs=maxRpoMs;this.#minImmutabilityMs=minImmutabilityMs;
  }
  recordBackup({manifest,traceId,actorId='backup-service'}){
    const clean=validateBackupManifest(manifest,{now:this.#now(),maxRpoMs:this.#maxRpoMs,minImmutabilityMs:this.#minImmutabilityMs});
    requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(actorId,'RECOVERY_ACTOR_REQUIRED',256);
    const prior=this.#store.listRecoveryEvidence(clean.tenantId,500).filter(x=>x.eventType==='BACKUP_VERIFIED'&&x.backupSetId===clean.backupSetId);
    if(prior.some(x=>x.backupId===clean.backupId&&x.manifestHash!==clean.manifestHash))throw new Error('BACKUP_ID_REUSED');
    const highest=prior.reduce((n,x)=>Math.max(n,Number(x.generation)||0),0);
    if(clean.generation<=highest&&!prior.some(x=>x.backupId===clean.backupId&&x.manifestHash===clean.manifestHash))throw new Error('BACKUP_GENERATION_NOT_MONOTONIC');
    const item=this.#store.recoveryEvidence({tenantId:clean.tenantId,traceId,actorId,eventType:'BACKUP_VERIFIED',backupId:clean.backupId,backupSetId:clean.backupSetId,generation:clean.generation,manifestHash:clean.manifestHash,restoreId:null,approverId:null,targetEnvironment:null,outcome:'SUCCESS',reason:'manifest_verified'});
    this.#store.audit({tenantId:clean.tenantId,traceId,actorId,action:'BACKUP_EVIDENCE_VERIFIED',objectId:clean.backupId,outcome:'SUCCESS',reason:'immutable_manifest'});
    return item;
  }
  authorizeRestore({tenantId,manifest,traceId,requesterId,approverId,targetEnvironment='isolated-recovery',reason,stepUpVerified=false}){
    requiredText(tenantId,'RECOVERY_TENANT_REQUIRED',256);requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(requesterId,'RECOVERY_REQUESTER_REQUIRED',256);requiredText(approverId,'RECOVERY_APPROVER_REQUIRED',256);requiredText(reason,'RECOVERY_REASON_REQUIRED',512);
    if(requesterId===approverId)throw new Error('RESTORE_DUAL_CONTROL_REQUIRED');
    if(!RESTORE_TARGETS.has(targetEnvironment))throw new Error('RESTORE_TARGET_INVALID');
    if(targetEnvironment==='production-recovery'&&(!this.#allowProductionRestore||stepUpVerified!==true))throw new Error('PRODUCTION_RESTORE_NOT_AUTHORIZED');
    const clean=validateBackupManifest(manifest,{tenantId,now:this.#now(),maxRpoMs:this.#maxRpoMs,minImmutabilityMs:this.#minImmutabilityMs});
    const recorded=this.#store.listRecoveryEvidence(tenantId,500).find(x=>x.eventType==='BACKUP_VERIFIED'&&x.backupId===clean.backupId&&x.manifestHash===clean.manifestHash);
    if(!recorded)throw new Error('RESTORE_BACKUP_EVIDENCE_MISSING');
    const id=restoreId();
    const item=this.#store.recoveryEvidence({tenantId,traceId,actorId:requesterId,approverId,eventType:'RESTORE_AUTHORIZED',backupId:clean.backupId,backupSetId:clean.backupSetId,generation:clean.generation,manifestHash:clean.manifestHash,restoreId:id,targetEnvironment,outcome:'AUTHORIZED',reason:reason.trim()});
    this.#store.audit({tenantId,traceId,actorId:requesterId,action:'RECOVERY_RESTORE_AUTHORIZED',objectId:id,outcome:'SUCCESS',reason:'dual_control'});
    return Object.freeze({restoreId:id,tenantId,backupId:clean.backupId,manifestHash:clean.manifestHash,targetEnvironment,requesterId,approverId,authorizedAt:item.at});
  }
  beginRestore({authorization,traceId,actorId}){
    if(!authorization||typeof authorization!=='object')throw new Error('RESTORE_AUTHORIZATION_REQUIRED');
    requiredText(traceId,'RECOVERY_TRACE_REQUIRED',256);requiredText(actorId,'RECOVERY_ACTOR_REQUIRED',256);
    const rows=this.#store.listRecoveryEvidence(authorization.tenantId,500);
    const auth=rows.find(x=>x.eventType==='RESTORE_AUTHORIZED'&&x.restoreId===authorization.restoreId&&x.backupId===authorization.backupId&&x.manifestHash===authorization.manifestHash);
    if(!auth)throw new Error('RESTORE_AUTHORIZATION_UNVERIFIED');
    if(rows.some(x=>x.restoreId===authorization.restoreId&&['RESTORE_STARTED','RESTORE_VERIFIED'].includes(x.eventType)))throw new Error('RESTORE_ALREADY_STARTED');
    const item=this.#store.recoveryEvidence({tenantId:authorization.tenantId,traceId,actorId,approverId:auth.approverId,eventType:'RESTORE_STARTED',backupId:auth.backupId,backupSetId:auth.backupSetId,generation:auth.generation,manifestHash:auth.manifestHash,restoreId:auth.restoreId,targetEnvironment:auth.targetEnvironment,outcome:'STARTED',reason:'authorized_restore'});
    this.#store.audit({tenantId:authorization.tenantId,traceId,actorId,action:'RECOVERY_RESTORE_STARTED',objectId:auth.restoreId,outcome:'SUCCESS',reason:'authorization_verified'});
    return item;
  }
  verifyRestore({tenantId,restoreId:rid,traceId,actorId,restoredContentHash,expectedManifestHash,integrityChecks,isolatedTarget=true}){
    for(const [v,c] of [[tenantId,'RECOVERY_TENANT_REQUIRED'],[rid,'RESTORE_ID_REQUIRED'],[traceId,'RECOVERY_TRACE_REQUIRED'],[actorId,'RECOVERY_ACTOR_REQUIRED']])requiredText(v,c,256);
    if(!HEX64.test(String(restoredContentHash??''))||!HEX64.test(String(expectedManifestHash??'')))throw new Error('RESTORE_HASH_INVALID');
    if(isolatedTarget!==true)throw new Error('RESTORE_TARGET_NOT_ISOLATED');
    if(!integrityChecks||integrityChecks.database!==true||integrityChecks.auditChain!==true||integrityChecks.objectReferences!==true||integrityChecks.tenantBoundary!==true)throw new Error('RESTORE_INTEGRITY_CHECKS_INCOMPLETE');
    const rows=this.#store.listRecoveryEvidence(tenantId,500),started=rows.find(x=>x.eventType==='RESTORE_STARTED'&&x.restoreId===rid);
    if(!started)throw new Error('RESTORE_START_EVIDENCE_MISSING');
    if(started.manifestHash!==expectedManifestHash)throw new Error('RESTORE_MANIFEST_MISMATCH');
    if(rows.some(x=>x.eventType==='RESTORE_VERIFIED'&&x.restoreId===rid))throw new Error('RESTORE_ALREADY_VERIFIED');
    const item=this.#store.recoveryEvidence({tenantId,traceId,actorId,approverId:started.approverId,eventType:'RESTORE_VERIFIED',backupId:started.backupId,backupSetId:started.backupSetId,generation:started.generation,manifestHash:started.manifestHash,restoreId:rid,targetEnvironment:started.targetEnvironment,outcome:'SUCCESS',reason:'integrity_verified',restoredContentHash});
    this.#store.audit({tenantId,traceId,actorId,action:'RECOVERY_RESTORE_VERIFIED',objectId:rid,outcome:'SUCCESS',reason:'clean_restore_integrity'});
    return item;
  }
}

export function verifyRecoveryEvidenceChain(entries,{genesis='0'.repeat(64)}={}){return verifyAuditChainEntries(entries,{genesis});}
export {auditEntryHash};
