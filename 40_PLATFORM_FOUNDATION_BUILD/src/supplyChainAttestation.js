import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const SHA=/^[a-f0-9]{64}$/;
const REV=/^[a-f0-9]{40}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const clone=v=>structuredClone(v);
const digest=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');
function hash(v,c){if(typeof v!=='string'||!SHA.test(v))throw new Error(c);return v;}
function id(v,c){if(typeof v!=='string'||!ID.test(v))throw new Error(c);return v;}
function text(v,c,max=128){if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw new Error(c);return v.trim();}
function revision(v){if(typeof v!=='string'||!REV.test(v))throw new Error('SUPPLY_CHAIN_SOURCE_REVISION_INVALID');return v;}

export function buildCycloneDxBom({name,version,nodeEngine,components=[]}){
  name=id(name,'SBOM_NAME_INVALID');version=id(version,'SBOM_VERSION_INVALID');nodeEngine=text(nodeEngine,'SBOM_NODE_ENGINE_INVALID',64);if(!Array.isArray(components)||components.length>5000)throw new Error('SBOM_COMPONENTS_INVALID');
  const normalized=components.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.name!=='string'||typeof x.version!=='string')throw new Error('SBOM_COMPONENT_INVALID');const c={type:x.type??'library',name:id(x.name,'SBOM_COMPONENT_NAME_INVALID'),version:id(x.version,'SBOM_COMPONENT_VERSION_INVALID')};if(x.purl!=null)c.purl=id(x.purl,'SBOM_COMPONENT_PURL_INVALID');return c;}).sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
  return Object.freeze({bomFormat:'CycloneDX',specVersion:'1.7',serialNumber:`urn:uuid:${crypto.randomUUID()}`,version:1,metadata:{component:{type:'application',name,version},properties:[{name:'legaltech:node-engine',value:nodeEngine}]},components:normalized});
}

export function supplyChainStatementHash(statement){return digest(statement);}

export class SupplyChainAttestationVerifier {
  #verify;#now;#events=[];
  constructor({verifySignature,now=()=>Date.now()}={}){if(typeof verifySignature!=='function'||typeof now!=='function')throw new Error('SUPPLY_CHAIN_ATTESTATION_CONFIGURATION_INVALID');this.#verify=verifySignature;this.#now=now;}
  async verify({releaseId,artifactSha256,sbomSha256,provenanceSha256,sourceRevision,builderId,buildType,attestationRefHash,issuedAt,signatureEnvelope}){
    releaseId=id(releaseId,'SUPPLY_CHAIN_RELEASE_ID_INVALID');artifactSha256=hash(artifactSha256,'SUPPLY_CHAIN_ARTIFACT_HASH_INVALID');sbomSha256=hash(sbomSha256,'SUPPLY_CHAIN_SBOM_HASH_INVALID');provenanceSha256=hash(provenanceSha256,'SUPPLY_CHAIN_PROVENANCE_HASH_INVALID');sourceRevision=revision(sourceRevision);builderId=id(builderId,'SUPPLY_CHAIN_BUILDER_INVALID');buildType=id(buildType,'SUPPLY_CHAIN_BUILD_TYPE_INVALID');attestationRefHash=hash(attestationRefHash,'SUPPLY_CHAIN_ATTESTATION_REF_HASH_INVALID');
    const ms=Date.parse(issuedAt);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==issuedAt||ms>this.#now()+300000||ms<this.#now()-30*86400000)throw new Error('SUPPLY_CHAIN_ISSUED_AT_INVALID');
    const statement=Object.freeze({releaseId,artifactSha256,sbomSha256,provenanceSha256,sourceRevision,builderId,buildType,issuedAt});const statementHash=supplyChainStatementHash(statement);let valid=false;try{valid=await this.#verify(Object.freeze({statementHash,attestationRefHash,signatureEnvelope}));}catch{throw new Error('SUPPLY_CHAIN_SIGNATURE_VERIFIER_UNAVAILABLE');}if(valid!==true)throw new Error('SUPPLY_CHAIN_ATTESTATION_INVALID');
    const result=Object.freeze({...statement,statementHash,attestationRefHash,verifiedAt:new Date(this.#now()).toISOString(),status:'VERIFIED'});this.#events.push(Object.freeze({id:`sce_${crypto.randomUUID()}`,releaseId,artifactSha256,sbomSha256,provenanceSha256,sourceRevision,builderRefHash:digest(builderId),buildTypeHash:digest(buildType),attestationRefHash,statementHash,verifiedAt:result.verifiedAt,status:'VERIFIED'}));return result;
  }
  events(){return Object.freeze(this.#events.map(x=>Object.freeze(clone(x))));}
}

export function createSupplyChainReadinessProbe({expectedArtifactSha256,expectedSourceRevision,getVerification}){
  hash(expectedArtifactSha256,'SUPPLY_CHAIN_ARTIFACT_HASH_INVALID');revision(expectedSourceRevision);if(typeof getVerification!=='function')throw new Error('SUPPLY_CHAIN_VERIFICATION_PROVIDER_INVALID');
  return async()=>{try{const v=await getVerification();if(!v||v.status!=='VERIFIED'||v.artifactSha256!==expectedArtifactSha256||v.sourceRevision!==expectedSourceRevision)return {ok:false,code:'SUPPLY_CHAIN_ATTESTATION_DRIFT'};return {ok:true,code:'SUPPLY_CHAIN_ATTESTATION_VERIFIED'};}catch{return {ok:false,code:'SUPPLY_CHAIN_ATTESTATION_UNAVAILABLE'};}};
}
