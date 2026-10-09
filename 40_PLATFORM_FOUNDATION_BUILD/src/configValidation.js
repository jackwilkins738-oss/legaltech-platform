import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const clone=v=>structuredClone(v);
function id(v,c,max=256){if(typeof v!=='string'||!ID.test(v)||v.length>max)throw new Error(c);return v;}
function hash(v,c){if(typeof v!=='string'||!SHA.test(v))throw new Error(c);return v;}

export class ConfigurationValidationRegistry {
  #run;#now;#certs=new Map();#events=[];
  constructor({runSyntheticSuite,now=()=>Date.now()}={}){if(typeof runSyntheticSuite!=='function'||typeof now!=='function')throw new Error('CONFIG_VALIDATION_CONFIGURATION_INVALID');this.#run=runSyntheticSuite;this.#now=now;}
  async certify({tenantId,bundleKey,version,bundleHash,scenarioSuiteHash,actorId,traceId}){
    tenantId=id(tenantId,'CONFIG_VALIDATION_TENANT_REQUIRED');bundleKey=id(bundleKey,'CONFIG_VALIDATION_BUNDLE_KEY_INVALID',100);actorId=id(actorId,'CONFIG_VALIDATION_ACTOR_REQUIRED');traceId=id(traceId,'CONFIG_VALIDATION_TRACE_REQUIRED');if(!Number.isInteger(version)||version<1)throw new Error('CONFIG_VALIDATION_VERSION_INVALID');bundleHash=hash(bundleHash,'CONFIG_VALIDATION_BUNDLE_HASH_INVALID');scenarioSuiteHash=hash(scenarioSuiteHash,'CONFIG_VALIDATION_SUITE_HASH_INVALID');
    let result;try{result=await this.#run(Object.freeze({tenantId,bundleKey,version,bundleHash,scenarioSuiteHash}));}catch{throw new Error('CONFIG_VALIDATION_RUNNER_UNAVAILABLE');}
    if(!result||typeof result!=='object'||!Number.isInteger(result.total)||!Number.isInteger(result.passed)||!Number.isInteger(result.failed)||result.total<1||result.total>10000||result.passed<0||result.failed<0||result.passed+result.failed!==result.total||typeof result.runnerVersion!=='string'||!VERSION.test(result.runnerVersion))throw new Error('CONFIG_VALIDATION_RESULT_INVALID');
    const evidenceHash=hash(result.evidenceHash,'CONFIG_VALIDATION_EVIDENCE_HASH_INVALID');if(result.failed!==0||result.passed!==result.total)throw new Error('CONFIG_VALIDATION_SUITE_FAILED');
    const cert=Object.freeze({id:`cvc_${crypto.randomUUID()}`,tenantId,bundleKey,version,bundleHash,scenarioSuiteHash,total:result.total,passed:result.passed,failed:0,evidenceHash,runnerVersion:result.runnerVersion,certifiedBy:actorId,certifiedAt:new Date(this.#now()).toISOString(),traceId});
    const key=`${tenantId}:${bundleKey}:${version}:${bundleHash}`;const list=this.#certs.get(key)??[];list.push(cert);this.#certs.set(key,list);this.#events.push(Object.freeze({id:`cve_${crypto.randomUUID()}`,tenantId,bundleKey,version,bundleHash,eventType:'CONFIG_SYNTHETIC_SUITE_CERTIFIED',actorId,traceId,occurredAt:cert.certifiedAt,evidenceHash,total:cert.total,runnerVersion:cert.runnerVersion}));return cert;
  }
  assertCertified({tenantId,bundleKey,version,bundleHash}){const key=`${tenantId}:${bundleKey}:${version}:${bundleHash}`,list=this.#certs.get(key)??[];if(!list.length)throw new Error('TENANT_CONFIG_SYNTHETIC_CERTIFICATION_REQUIRED');return true;}
  certifications(tenantId){return Object.freeze([...this.#certs.values()].flat().filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
  events(tenantId){return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(x=>Object.freeze(clone(x))));}
}
