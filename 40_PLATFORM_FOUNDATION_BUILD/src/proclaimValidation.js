import {appError} from './errors.js';import {integrationRecord,integrationOptions,integrationJson} from './integrationInput.js';
const identifier=(value,max=512)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const invalid=()=>appError('invalid validation request',{code:'INVALID_REQUEST'});
const unavailable=()=>appError('resource unavailable',{status:404,code:'NOT_FOUND'});
const supported=[['GET_MATTER','getMatter'],['SEARCH_MATTER','searchMatter'],['GET_HISTORY','getHistory'],['CREATE_HISTORY','createHistory']];
function method(adapter,key){for(let value=adapter;value&&value!==Object.prototype;value=Object.getPrototypeOf(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(d)return Object.hasOwn(d,'value')&&typeof d.value==='function'?d.value.bind(adapter):null;}return null;}
function field(value,key){const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
function configProjection(config,tenantId){
  try{
    if(!integrationRecord(config)||field(config,'tenantId')!==tenantId||field(config,'kind')!=='PROCLAIM'||field(config,'mode')!=='MOCK'||!identifier(field(config,'id'),200)||!Number.isSafeInteger(field(config,'revision'))||field(config,'revision')<1)return null;
    const capabilities=integrationJson(field(config,'capabilities'));if(!Array.isArray(capabilities)||capabilities.length>100||!capabilities.every(cap=>identifier(cap,128)))return null;
    return {id:field(config,'id'),revision:field(config,'revision'),capabilities};
  }catch{return null;}
}
function historyBound(history,tenantId,externalMatterId){
  try{
    if(!Array.isArray(history)||Object.getPrototypeOf(history)!==Array.prototype||history.length>1000)return false;
    const ids=new Set();for(let i=0;i<history.length;i++){const d=Object.getOwnPropertyDescriptor(history,String(i));if(!d||!Object.hasOwn(d,'value'))return false;const row=d.value;if(!integrationRecord(row))return false;const id=field(row,'id');if(!identifier(id,200)||ids.has(id)||field(row,'tenantId')!==tenantId||field(row,'externalMatterId')!==externalMatterId)return false;ids.add(id);}return true;
  }catch{return false;}
}
export class ProclaimValidationHarness {
  #get;#upsert;#update;#read;#capabilities;#active=Symbol();
  constructor(input={}){
    const {registry,adapter,tenantId}=integrationOptions(input,{registry:undefined,adapter:undefined,tenantId:'tenant-demo'});
    if(!identifier(tenantId,200)||tenantId.trim()!==tenantId||typeof registry?.get!=='function'||typeof registry?.upsert!=='function'||typeof registry?.updateIfCurrent!=='function')throw invalid();
    this.#get=registry.get.bind(registry);this.#upsert=registry.upsert.bind(registry);this.#update=registry.updateIfCurrent.bind(registry);this.#read=method(adapter,'getHistory');this.#capabilities=supported.filter(([,key])=>method(adapter,key)).map(([cap])=>cap);
    Object.defineProperties(this,{tenantId:{value:tenantId,enumerable:true},capabilities:{get:()=>[...this.#capabilities],enumerable:true}});
  }
  configure(input={}){
    const {apiVersion,transport,endpointLabel}=integrationOptions(input,{apiVersion:'UNVERIFIED',transport:'MOCK',endpointLabel:'synthetic-proclaim'});
    if(!identifier(apiVersion,128)||!identifier(transport,64)||!identifier(endpointLabel,256))throw invalid();
    const result=this.#upsert({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:'READY_FOR_VALIDATION',capabilities:this.#capabilities,metadata:{apiVersion,transport,endpointLabel,credentialMode:'MOCK_SECRET_REF',lastValidation:null},health:{state:'UNVERIFIED',lastCheck:new Date().toISOString()}});
    this.#active=Symbol();return result;
  }
  async runValidation(input={}){
    const {externalMatterId}=integrationOptions(input,{externalMatterId:'PROCLAIM-DEMO-1'});if(!identifier(externalMatterId))throw invalid();
    const config=configProjection(this.#get(this.tenantId,'PROCLAIM'),this.tenantId);if(!config)throw unavailable();
    const active=Symbol();this.#active=active;const checks=[],push=(name,status,detail)=>checks.push({name,status,detail});
    if(!config.capabilities.includes('GET_HISTORY')||!this.#read)push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_READ_UNAVAILABLE');
    else{try{const history=await this.#read({tenantId:this.tenantId,externalMatterId});if(historyBound(history,this.tenantId,externalMatterId))push('READ_HISTORY','PASS',`Read ${history.length} owned synthetic history item(s)`);else push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_INVALID');}catch{push('READ_HISTORY','FAIL','SYNTHETIC_HISTORY_READ_FAILED');}}
    push('WRITE_IDEMPOTENCY_CONTRACT','NOT_TESTED','Requires an explicit synthetic write contract test; this validation sends no writes');
    push('WRITE_READ_RECONCILIATION','NOT_TESTED','Requires explicit write/read-back evidence; this validation checks reads only');
    push('LIVE_API_VERSION','BLOCKED','Requires authorised customer Proclaim environment');push('LIVE_PERMISSION_SCOPE','BLOCKED','Requires authorised customer credentials and licensed API details');
    const pass=checks.filter(x=>x.status==='PASS').length,blocked=checks.filter(x=>x.status==='BLOCKED').length,fail=checks.filter(x=>x.status==='FAIL').length,notTested=checks.filter(x=>x.status==='NOT_TESTED').length;
    const current=configProjection(this.#get(this.tenantId,'PROCLAIM'),this.tenantId),result={status:fail?'RED':blocked||notTested?'AMBER':'GREEN',pass,blocked,fail,notTested,checks,validatedAt:new Date().toISOString(),mode:'MOCK',persisted:false,superseded:true};
    if(active===this.#active&&current&&current.id===config.id&&current.revision===config.revision){
      const candidate={...result,persisted:true,superseded:false};const saved=this.#update({tenantId:this.tenantId,kind:'PROCLAIM',mode:'MOCK',status:fail?'VALIDATION_FAILED':'VALIDATION_INCOMPLETE',capabilities:current.capabilities,health:{state:fail?'DEGRADED':'READ_ONLY_VALIDATED',lastCheck:result.validatedAt},metadata:{lastValidation:candidate}},{id:config.id,revision:config.revision});
      if(saved){const proof=configProjection(saved,this.tenantId);if(proof?.id===config.id&&proof.revision===config.revision+1){const recorded=this.#get(this.tenantId,'PROCLAIM'),readback=configProjection(recorded,this.tenantId);let same=false;try{same=JSON.stringify(integrationJson(field(field(recorded,'metadata'),'lastValidation')))===JSON.stringify(candidate);}catch{}if(readback?.id===proof.id&&readback.revision===proof.revision&&same){result.persisted=true;result.superseded=false;}}}
    }
    return result;
  }
}
