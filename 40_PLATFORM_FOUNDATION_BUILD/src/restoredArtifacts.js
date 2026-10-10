import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';
const ID=/^[A-Za-z0-9._:-]{1,256}$/,ARTIFACT=/^[A-Za-z0-9_-]{1,96}$/,HEX=/^[a-f0-9]{64}$/;
const verified=new WeakSet(),fail=()=>new Error('RESTORE_ARTIFACT_EVIDENCE_INVALID');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function exactRecord(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw fail();return value;
}
export function validateRestoreInventory(value){
  exactRecord(value,['version','tenantId','backupId','objectCount','artifacts']);
  if(value.version!=='v138'||typeof value.tenantId!=='string'||typeof value.backupId!=='string'||!ID.test(value.tenantId)||!ID.test(value.backupId)
    ||!Number.isSafeInteger(value.objectCount)||value.objectCount<0||!Array.isArray(value.artifacts)||Object.getPrototypeOf(value.artifacts)!==Array.prototype||value.artifacts.length<1||value.artifacts.length>1001
    ||Reflect.ownKeys(value.artifacts).length!==value.artifacts.length+1)throw fail();
  for(let i=0;i<value.artifacts.length;i++)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(value.artifacts,String(i))??{},'value'))throw fail();
  let bytes=0;const artifacts=value.artifacts.map(v=>{
    exactRecord(v,['artifactId','kind','size','hash']);
    if(typeof v.artifactId!=='string'||!ARTIFACT.test(v.artifactId)||!['DATABASE','OBJECT'].includes(v.kind)||!Number.isSafeInteger(v.size)||v.size<0||v.size>64*1024*1024||typeof v.hash!=='string'||!HEX.test(v.hash))throw fail();
    bytes+=v.size;return Object.freeze({...v});
  }).sort((a,b)=>a.artifactId<b.artifactId?-1:a.artifactId>b.artifactId?1:0);
  if(bytes>256*1024*1024||new Set(artifacts.map(v=>v.artifactId)).size!==artifacts.length||artifacts.filter(v=>v.kind==='DATABASE').length!==1
    ||artifacts.some(v=>v.kind==='DATABASE'&&v.size===0)||artifacts.filter(v=>v.kind==='OBJECT').length!==value.objectCount)throw fail();
  return Object.freeze({version:'v138',tenantId:value.tenantId,backupId:value.backupId,objectCount:value.objectCount,artifacts:Object.freeze(artifacts)});
}
export function restoreInventoryHash(inventory){return digest(canonicalAuditPayload(validateRestoreInventory(inventory)));}
export const isRestoredArtifactEvidence=value=>verified.has(value);
export class RestoredArtifactVerifier {
  #inventory;#context;#seen=new Set();#failed=false;#complete=false;
  constructor({inventory,context}={}){
    this.#inventory=validateRestoreInventory(inventory);
    exactRecord(context,['restoreId','targetEnvironment','backupManifestHash']);
    if(typeof context.restoreId!=='string'||!ID.test(context.restoreId)||!['isolated-recovery','staging-recovery','production-recovery'].includes(context.targetEnvironment)
      ||typeof context.backupManifestHash!=='string'||!HEX.test(context.backupManifestHash))throw fail();
    this.#context=Object.freeze({...context});Object.freeze(this);
  }
  checkArtifact({artifactId,bytes}={}){
    if(this.#failed||this.#complete)throw fail();
    try{
      const expected=this.#inventory.artifacts.find(v=>v.artifactId===artifactId);
      if(!expected||this.#seen.has(artifactId)||!Buffer.isBuffer(bytes)||bytes.length!==expected.size||digest(bytes)!==expected.hash)throw fail();
      this.#seen.add(artifactId);
    }catch{this.#failed=true;throw fail();}
  }
  complete(){
    if(this.#failed||this.#complete||this.#seen.size!==this.#inventory.artifacts.length){this.#failed=true;throw fail();}
    this.#complete=true;
    const evidence=Object.freeze({tenantId:this.#inventory.tenantId,backupId:this.#inventory.backupId,...this.#context,
      contentHash:restoreInventoryHash(this.#inventory),artifactCount:this.#seen.size,objectCount:this.#inventory.objectCount,totalBytes:this.#inventory.artifacts.reduce((n,v)=>n+v.size,0)});
    verified.add(evidence);return evidence;
  }
}
