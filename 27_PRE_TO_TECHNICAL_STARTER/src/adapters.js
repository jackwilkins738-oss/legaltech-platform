export class MockGraphAdapter {
  constructor(messages=[]){ this.messages=new Map(messages.map(x=>[x.email_id,x])); }
  async healthCheck(){ return {state:'HEALTHY'}; }
  async getMessage(_mailboxId,messageId){ const x=this.messages.get(messageId); if(!x) throw new Error('message not found'); return structuredClone(x); }
  async getAttachments(){ return []; }
}

export class MockProclaimAdapter {
  constructor(matters=[]){ this.matters=new Map(matters.map(x=>[x.matter_id,{...x,history:[]} ])); this.writeKeys=new Map(); }
  async healthCheck(){ return {state:'HEALTHY'}; }
  async getMatterByExternalId(id){ return structuredClone(this.matters.get(id)??null); }
  async createHistory({externalMatterId,idempotencyKey,payload}){
    if(this.writeKeys.has(idempotencyKey)) return structuredClone(this.writeKeys.get(idempotencyKey));
    const m=this.matters.get(externalMatterId); if(!m) throw new Error('matter not found');
    const externalWriteId=`hist_${m.history.length+1}`;
    m.history.push({externalWriteId,payload});
    const result={externalWriteId,verified:false}; this.writeKeys.set(idempotencyKey,result); return structuredClone(result);
  }
  async verifyHistory({externalMatterId,externalWriteId}){
    const m=this.matters.get(externalMatterId); return Boolean(m?.history.some(x=>x.externalWriteId===externalWriteId));
  }
}
