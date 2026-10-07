const injection=/ignore (?:all|previous|prior) instructions|reveal secrets|exfiltrat|search every client|system prompt/i;
export class DeterministicAIGateway {
  async classifyInbound({authorizedContext}) {
    const text=`${authorizedContext.subject||''}\n${authorizedContext.body||''}`;
    if(injection.test(text)) return {status:'BLOCKED',classification:'UNTRUSTED_INSTRUCTION',confidence:1,reason:'prompt_injection_signal',model:'deterministic-safety-v1'};
    const lower=text.toLowerCase();
    const classification=lower.includes('medical')?'MEDICAL_CORRESPONDENCE':lower.includes('offer')?'OFFER_CORRESPONDENCE':'GENERAL_CORRESPONDENCE';
    return {status:'OK',classification,confidence:0.8,reason:'synthetic_rules_only',model:'deterministic-classifier-v1'};
  }
}

// This is the approved synthetic contract, not permission to promote a live model.
export function normalizeClassificationResult(value) {
  const invalid=()=>{throw new Error('invalid classification response');};
  if(value===null||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
  const output={};
  for(const field of ['status','classification','confidence','model']) {
    const descriptor=Object.getOwnPropertyDescriptor(value,field);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))invalid();
    output[field]=descriptor.value;
  }
  if(!Number.isFinite(output.confidence)||output.confidence<0||output.confidence>1)invalid();
  if(output.status==='OK') {
    if(output.model!=='deterministic-classifier-v1'||!['GENERAL_CORRESPONDENCE','MEDICAL_CORRESPONDENCE','OFFER_CORRESPONDENCE'].includes(output.classification))invalid();
    output.reason='synthetic_rules_only';
  } else if(output.status==='BLOCKED') {
    if(output.model!=='deterministic-safety-v1'||output.classification!=='UNTRUSTED_INSTRUCTION')invalid();
    // The reason is an application code, never arbitrary classifier/provider text.
    output.reason='untrusted_classification';
  } else invalid();
  return output;
}
