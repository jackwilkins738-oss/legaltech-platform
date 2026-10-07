import {appError} from './errors.js';
const identifier=(value,max=512)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const invalid=()=>appError('invalid validation request',{code:'INVALID_REQUEST'});
const supported=[['GET_MATTER','getMatter'],['SEARCH_MATTER','searchMatter'],['GET_HISTORY','getHistory'],['CREATE_HISTORY','createHistory']];
export class ProclaimValidationHarness {
  constructor({registry,adapter,tenantId='tenant-demo'}={}) {
    if(!identifier(tenantId,200))throw invalid();
    Object.assign(this,{registry,adapter,tenantId});this.validationGeneration=0;
    this.capabilities=supported.filter(([,method])=>typeof adapter?.[method]==='function').map(([cap])=>cap);
  }
  configure({apiVersion='UNVERIFIED',transport='MOCK',endpointLabel='synthetic-proclaim'}={}) {
    if(!identifier(apiVersion,128)||!identifier(transport,64)||!identifier(endpointLabel,256))throw invalid();
    const result=this.registry.upsert({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:this.capabilities,metadata:{apiVersion,transport,endpointLabel,credentialMode:'MOCK_SECRET_REF',lastValidation:null},health:{state:'UNVERIFIED',lastCheck:new Date().toISOString()}});
    this.validationGeneration++;return result;
  }
  async runValidation({externalMatterId='PROCLAIM-DEMO-1'}={}) {
    if(!identifier(externalMatterId))throw invalid();
    const config=this.registry.get(this.tenantId,'PROCLAIM');
    if(!config||config.mode!=='MOCK')throw appError('resource unavailable',{status:404,code:'NOT_FOUND'});
    const generation=++this.validationGeneration,checks=[];
    const push=(name,status,detail)=>checks.push({name,status,detail});
    if(!config.capabilities.includes('GET_HISTORY')||typeof this.adapter?.getHistory!=='function')push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_READ_UNAVAILABLE');
    else {
      try {
        const history=await this.adapter.getHistory({tenantId:this.tenantId,externalMatterId});
        const valid=Array.isArray(history)&&history.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.tenantId===this.tenantId&&row.externalMatterId===externalMatterId&&identifier(row.id,200));
        if(valid)push('READ_HISTORY','PASS',`Read ${history.length} owned synthetic history item(s)`);
        else push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_INVALID');
      } catch {push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_READ_FAILED');}
    }
    push('WRITE_IDEMPOTENCY_CONTRACT','NOT_TESTED','Requires an explicit synthetic write contract test; this validation sends no writes');
    push('WRITE_READ_RECONCILIATION','NOT_TESTED','Requires explicit write/read-back evidence; this validation checks reads only');
    push('LIVE_API_VERSION','BLOCKED','Requires authorised customer Proclaim environment');
    push('LIVE_PERMISSION_SCOPE','BLOCKED','Requires authorised customer credentials and licensed API details');
    const pass=checks.filter(x=>x.status==='PASS').length,blocked=checks.filter(x=>x.status==='BLOCKED').length,fail=checks.filter(x=>x.status==='FAIL').length,notTested=checks.filter(x=>x.status==='NOT_TESTED').length;
    const current=this.registry.get(this.tenantId,'PROCLAIM');
    const persisted=generation===this.validationGeneration&&current?.id===config.id&&current?.revision===config.revision;
    const result={status:fail?'RED':blocked||notTested?'AMBER':'GREEN',pass,blocked,fail,notTested,checks,validatedAt:new Date().toISOString(),mode:'MOCK',persisted,superseded:!persisted};
    if(persisted)this.registry.upsert({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:result.status==='RED'?'VALIDATION_FAILED':'VALIDATION_INCOMPLETE',capabilities:current.capabilities,health:{state:fail?'DEGRADED':'READ_ONLY_VALIDATED',lastCheck:result.validatedAt},metadata:{lastValidation:result}});
    return result;
  }
}
