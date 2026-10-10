const CHECK_NAME = /^[A-Z0-9_.:-]{1,64}$/;
const SAFE_CODE = /^[A-Z0-9_.:-]{1,64}$/;
const ALLOWED_RESULT_KEYS = new Set(['ok','code']);

function boundedInteger(value,{name,min,max}) {
  if(!Number.isInteger(value)||value<min||value>max) throw new Error(`INVALID_${name}`);
  return value;
}
function normalizeCheck(check) {
  if(!check||typeof check!=='object'||Array.isArray(check)) throw new Error('INVALID_READINESS_CHECK');
  const keys=Object.keys(check);
  if(keys.some(key=>!['name','critical','probe'].includes(key))) throw new Error('INVALID_READINESS_CHECK');
  if(!CHECK_NAME.test(check.name??'')) throw new Error('INVALID_READINESS_CHECK_NAME');
  if(check.critical!==undefined&&typeof check.critical!=='boolean') throw new Error('INVALID_READINESS_CHECK_CRITICAL');
  if(typeof check.probe!=='function') throw new Error('INVALID_READINESS_CHECK_PROBE');
  return Object.freeze({name:check.name,critical:check.critical!==false,probe:check.probe});
}
function normalizeProbeResult(value) {
  if(value===true) return {ok:true,code:'OK'};
  if(value===false) return {ok:false,code:'CHECK_FAILED'};
  if(!value||typeof value!=='object'||Array.isArray(value)) return {ok:false,code:'CHECK_FAILED'};
  if(Object.keys(value).some(key=>!ALLOWED_RESULT_KEYS.has(key))) return {ok:false,code:'CHECK_FAILED'};
  if(typeof value.ok!=='boolean') return {ok:false,code:'CHECK_FAILED'};
  if(value.code!==undefined&&!SAFE_CODE.test(value.code)) return {ok:false,code:'CHECK_FAILED'};
  return {ok:value.ok,code:value.ok?(value.code??'OK'):(value.code??'CHECK_FAILED')};
}
async function runBounded(check,timeoutMs,pending) {
  if(pending.has(check.name))return Object.freeze({name:check.name,critical:check.critical,ok:false,code:'CHECK_BUSY'});
  const controller=new AbortController();
  let timer;
  try {
    const timeout=new Promise(resolve=>{
      timer=setTimeout(()=>{ controller.abort(); resolve({timedOut:true}); },timeoutMs);
    });
    const probe=Promise.resolve().then(()=>check.probe({signal:controller.signal})).then(value=>({value}),()=>({failed:true}));
    pending.set(check.name,probe);
    probe.finally(()=>{if(pending.get(check.name)===probe)pending.delete(check.name);}).catch(()=>{});
    const outcome=await Promise.race([probe,timeout]);
    if(outcome?.timedOut) return Object.freeze({name:check.name,critical:check.critical,ok:false,code:'CHECK_TIMEOUT'});
    if(outcome?.failed) return Object.freeze({name:check.name,critical:check.critical,ok:false,code:'CHECK_FAILED'});
    const normalized=normalizeProbeResult(outcome.value);
    return Object.freeze({name:check.name,critical:check.critical,...normalized});
  } finally { if(timer) clearTimeout(timer); }
}
function freezeResult(value) {
  return Object.freeze({...value,checks:Object.freeze(value.checks.map(check=>Object.freeze({...check})))});
}

export class ReadinessCoordinator {
  #pending=new Map();#lastClock=-Infinity;
  constructor({checks=[],probeTimeoutMs=1000,cacheTtlMs=1000,now=()=>Date.now()}={}) {
    if(!Array.isArray(checks)||checks.length<1||checks.length>32) throw new Error('INVALID_READINESS_CHECKS');
    this.checks=Object.freeze(checks.map(normalizeCheck));
    if(new Set(this.checks.map(check=>check.name)).size!==this.checks.length) throw new Error('DUPLICATE_READINESS_CHECK');
    this.probeTimeoutMs=boundedInteger(probeTimeoutMs,{name:'READINESS_TIMEOUT',min:100,max:5000});
    this.cacheTtlMs=boundedInteger(cacheTtlMs,{name:'READINESS_CACHE_TTL',min:250,max:60000});
    if(typeof now!=='function') throw new Error('INVALID_READINESS_CLOCK');
    this.now=now;
    this.cached=null;
    this.inFlight=null;
    this.generation=0;
  }
  async evaluate({force=false}={}) {
    const at=this.now();
    if(!Number.isFinite(at)||at<this.#lastClock){
      this.invalidate();return freezeResult({status:'NOT_READY',checks:this.checks.map(check=>({name:check.name,critical:check.critical,ok:false,code:'CLOCK_INVALID'}))});
    }
    this.#lastClock=at;
    if(!force&&this.cached&&at<this.cached.expiresAt) return this.cached.result;
    if(!force&&this.inFlight) {
      const generation=this.generation;
      const result=await this.inFlight;
      return generation===this.generation?result:this.evaluate();
    }
    const generation=this.generation;
    const run=(async()=>{
      const checks=await Promise.all(this.checks.map(check=>runBounded(check,this.probeTimeoutMs,this.#pending)));
      const status=checks.some(check=>check.critical&&!check.ok)?'NOT_READY':checks.some(check=>!check.ok)?'DEGRADED':'READY';
      const result=freezeResult({status,checks});
      const finishedAt=this.now();
      if(!Number.isFinite(finishedAt)||finishedAt<this.#lastClock){this.invalidate();return freezeResult({status:'NOT_READY',checks:checks.map(check=>({...check,ok:false,code:'CLOCK_INVALID'}))});}
      this.#lastClock=finishedAt;
      if(generation===this.generation) this.cached={expiresAt:finishedAt+this.cacheTtlMs,result};
      return result;
    })();
    if(!force) this.inFlight=run;
    try { const result=await run; return generation===this.generation?result:this.evaluate(); }
    finally { if(this.inFlight===run) this.inFlight=null; }
  }
  async publicStatus() {
    const result=await this.evaluate();
    return Object.freeze({status:result.status});
  }
  invalidate() { this.generation++; this.cached=null; this.inFlight=null; }
}
