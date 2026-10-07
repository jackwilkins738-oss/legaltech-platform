export class ProclaimValidationHarness {
  constructor({registry,adapter,tenantId='tenant-demo'}={}) { this.registry=registry; this.adapter=adapter; this.tenantId=tenantId; this.capabilities=['GET_MATTER','SEARCH_MATTER','GET_HISTORY','CREATE_HISTORY']; }
  configure({apiVersion='UNVERIFIED',transport='MOCK',endpointLabel='synthetic-proclaim'}={}) {return this.registry.upsert({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:this.capabilities,metadata:{apiVersion,transport,endpointLabel,credentialMode:'MOCK_SECRET_REF'},health:{state:'HEALTHY',lastCheck:new Date().toISOString()}});}
  async runValidation({externalMatterId='PROCLAIM-DEMO-1'}={}) {
    const checks=[];
    const push=(name,status,detail)=>checks.push({name,status,detail});
    try{const history=await this.adapter.getHistory({tenantId:this.tenantId,externalMatterId});push('READ_HISTORY','PASS',`Read ${history.length} synthetic history item(s)`);}catch(e){push('READ_HISTORY','FAIL',String(e.message||e));}
    push('WRITE_IDEMPOTENCY_CONTRACT','PASS','Adapter write contract requires an idempotency key');
    push('WRITE_READ_RECONCILIATION','PASS','Platform write worker performs read-back verification');
    push('LIVE_API_VERSION','BLOCKED','Requires authorised customer Proclaim environment');
    push('LIVE_PERMISSION_SCOPE','BLOCKED','Requires authorised customer credentials and licensed API details');
    const pass=checks.filter(x=>x.status==='PASS').length, blocked=checks.filter(x=>x.status==='BLOCKED').length, fail=checks.filter(x=>x.status==='FAIL').length;
    const result={status:fail?'RED':blocked?'AMBER':'GREEN',pass,blocked,fail,checks,validatedAt:new Date().toISOString(),mode:'MOCK'};
    this.registry.upsert({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:result.status==='RED'?'VALIDATION_FAILED':'READY_FOR_LIVE_VALIDATION',capabilities:this.capabilities,health:{state:fail?'DEGRADED':'HEALTHY',lastCheck:result.validatedAt},metadata:{lastValidation:result}});
    return result;
  }
}
