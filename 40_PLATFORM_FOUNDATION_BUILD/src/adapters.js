export class MockGraphAdapter {
  constructor(messages=[]){this.messages=new Map(messages.map(m=>[m.id,structuredClone(m)]));}
  async healthCheck(){return {state:'HEALTHY'};}
  async getMessage(_mailboxId,messageId){return structuredClone(this.messages.get(messageId)||null);}
  async getAttachments(_mailboxId,messageId){return structuredClone(this.messages.get(messageId)?.attachments||[]);}
}
export class MockProclaimAdapter {
  constructor(){this.history=[];}
  async healthCheck(){return {state:'HEALTHY'};}
  async createHistory({tenantId,externalMatterId,idempotencyKey,payload}){
    const existing=this.history.find(x=>x.tenantId===tenantId&&x.idempotencyKey===idempotencyKey);
    if(existing)return {externalWriteId:existing.id,verified:true,duplicate:true};
    const row={id:`hist_${this.history.length+1}`,tenantId,externalMatterId,idempotencyKey,payload:structuredClone(payload)};this.history.push(row);
    return {externalWriteId:row.id,verified:true,duplicate:false};
  }
  async getHistory({tenantId,externalMatterId}){return this.history.filter(x=>x.tenantId===tenantId&&x.externalMatterId===externalMatterId).map(x=>structuredClone(x));}
}

// Trusted adapters may use this ONLY when evidence proves no external write occurred.
// Timeouts, transport errors and malformed responses must remain uncertain.
export class KnownWriteFailure extends Error {
  constructor({retryable = false, code = 'MOCK_FAILURE'} = {}) {
    const safeCode = ['RATE_LIMITED', 'AUTH_REVOKED', 'UNAVAILABLE', 'INVALID_REQUEST', 'MOCK_FAILURE'].includes(code) ? code : 'MOCK_FAILURE';
    super(safeCode);
    this.retryable = retryable === true;
    this.code = safeCode;
  }
}
