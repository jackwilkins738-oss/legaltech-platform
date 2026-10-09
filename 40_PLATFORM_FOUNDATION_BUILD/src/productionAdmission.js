import {ReadinessCoordinator} from './readiness.js';

// These probes must exercise the actual adapters bound by the deployment root.
// Registration validates coverage; it cannot attest that an arbitrary callback is honest.
export const REQUIRED_PRODUCTION_PROBES=Object.freeze([
  'DATABASE_RUNTIME','SCHEMA','IDENTITY','SESSION_STORE','RATE_LIMIT_STORE',
  'AUDIT_SINK','OBJECT_STORAGE','QUEUE','DOCUMENT_SECURITY','SECURITY_INTERLOCK',
  'WORKER_AUTHORIZATION','DEPLOYMENT_DRAIN','CLOCK_INTEGRITY',
]);
const registered=new WeakSet();
export function createProductionReadiness({probes,probeTimeoutMs=1000,cacheTtlMs=250,now}={}) {
  if(!probes||typeof probes!=='object'||Array.isArray(probes)
    ||Reflect.ownKeys(probes).length!==REQUIRED_PRODUCTION_PROBES.length
    ||REQUIRED_PRODUCTION_PROBES.some(name=>typeof Object.getOwnPropertyDescriptor(probes,name)?.value!=='function')) {
    throw new Error('PRODUCTION_READINESS_PROBES_REQUIRED');
  }
  if(!Number.isInteger(cacheTtlMs)||cacheTtlMs<250||cacheTtlMs>1000) throw new Error('PRODUCTION_READINESS_CACHE_INVALID');
  const coordinator=new ReadinessCoordinator({
    checks:REQUIRED_PRODUCTION_PROBES.map(name=>({name,critical:true,probe:probes[name]})),
    probeTimeoutMs,cacheTtlMs,...(now===undefined?{}:{now}),
  });
  // Keep the coverage, methods and deadlines immutable after registration.
  Object.defineProperties(coordinator,{
    checks:{writable:false},probeTimeoutMs:{writable:false},cacheTtlMs:{writable:false},now:{writable:false},
  });
  const facade=Object.freeze({
    publicStatus:()=>coordinator.publicStatus(),
    invalidate:()=>coordinator.invalidate(),
  });
  registered.add(facade);
  return facade;
}
export function isProductionReadiness(value) { return registered.has(value); }

// A broken/custom readiness adapter must not leave a request waiting indefinitely.
export async function boundedReadinessStatus(readiness,timeoutMs) {
  if(!readiness||typeof readiness.publicStatus!=='function') return 'NOT_READY';
  let timer;
  try {
    const expired=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);});
    const pending=Promise.resolve().then(()=>readiness.publicStatus());
    const state=await Promise.race([pending,expired]);
    return ['READY','DEGRADED'].includes(state?.status)?state.status:'NOT_READY';
  } catch { return 'NOT_READY'; }
  finally { clearTimeout(timer); }
}
