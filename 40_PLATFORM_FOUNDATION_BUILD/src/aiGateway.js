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
