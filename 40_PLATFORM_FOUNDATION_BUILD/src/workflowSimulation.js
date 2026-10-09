import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';
import {validateWorkflowDefinition} from './workflowRuntime.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const clone=v=>structuredClone(v);
const sha=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');
function id(v,c,max=256){if(typeof v!=='string'||!ID.test(v)||v.length>max)throw new Error(c);return v;}
function object(v,c,max=32768){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(c);const raw=canonicalAuditPayload(v);if(Buffer.byteLength(raw)>max)throw new Error('WORKFLOW_SIMULATION_CONTEXT_TOO_LARGE');return clone(v);}
function readPath(ctx,path){let value=ctx;for(const part of path.split('.')){if(!part||value==null||typeof value!=='object'||!Object.hasOwn(value,part))return undefined;value=value[part];}return value;}

export class WorkflowSimulator {
  #assertSynthetic;#now;
  constructor({assertSynthetic,now=()=>Date.now()}={}){if(typeof assertSynthetic!=='function'||typeof now!=='function')throw new Error('WORKFLOW_SIMULATION_CONFIGURATION_INVALID');this.#assertSynthetic=assertSynthetic;this.#now=now;}
  simulate({tenantId,scenarioId,dataClass,definition,context={},maxSteps=100}){
    tenantId=id(tenantId,'WORKFLOW_SIMULATION_TENANT_REQUIRED');scenarioId=id(scenarioId,'WORKFLOW_SIMULATION_SCENARIO_INVALID');if(dataClass!=='SYNTHETIC')throw new Error('WORKFLOW_SIMULATION_SYNTHETIC_ONLY');if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>100)throw new Error('WORKFLOW_SIMULATION_STEP_LIMIT_INVALID');
    const cleanContext=object(context,'WORKFLOW_SIMULATION_CONTEXT_INVALID');let synthetic=false;try{synthetic=this.#assertSynthetic(Object.freeze({tenantId,scenarioId,dataClass,contextHash:sha(cleanContext)}))===true;}catch{throw new Error('WORKFLOW_SIMULATION_SYNTHETIC_VALIDATION_UNAVAILABLE');}if(!synthetic)throw new Error('WORKFLOW_SIMULATION_SYNTHETIC_VALIDATION_FAILED');
    const def=validateWorkflowDefinition(definition),map=new Map(def.steps.map(x=>[x.id,x])),effects=[],path=[];let stepId=def.entryStepId,status='RUNNING',wait=null;
    for(let count=0;count<maxSteps;count++){
      const step=map.get(stepId);if(!step)throw new Error('WORKFLOW_SIMULATION_STEP_UNAVAILABLE');path.push(step.id);
      if(step.kind==='CREATE_WORK'){effects.push(Object.freeze({kind:'CREATE_WORK',stepId:step.id,workType:step.work.type??'TASK',owner:Object.freeze(clone(step.work.owner)),titleHash:sha(step.work.title),priority:step.work.priority??50}));stepId=step.next;continue;}
      if(step.kind==='NOTIFY'){effects.push(Object.freeze({kind:'NOTIFY',stepId:step.id,channel:step.channel,templateId:step.templateId,recipient:Object.freeze(clone(step.recipient)),severity:step.severity??'NORMAL'}));stepId=step.next;continue;}
      if(step.kind==='BRANCH'){const matched=canonicalAuditPayload(readPath(cleanContext,step.condition.path))===canonicalAuditPayload(step.condition.equals);effects.push(Object.freeze({kind:'BRANCH',stepId:step.id,matched}));stepId=matched?step.whenTrue:step.whenFalse;continue;}
      if(step.kind==='WAIT_FOR_SIGNAL'){status='WAITING';wait=Object.freeze({kind:'SIGNAL',signal:step.signal,stepId:step.id});break;}
      if(step.kind==='DELAY'){status='WAITING';wait=Object.freeze({kind:'DELAY',delayMs:step.delayMs,stepId:step.id});break;}
      if(step.kind==='COMPLETE'){status='COMPLETED';effects.push(Object.freeze({kind:'COMPLETE',stepId:step.id}));break;}
    }
    if(status==='RUNNING')throw new Error('WORKFLOW_SIMULATION_STEP_LIMIT');
    const result={tenantId,scenarioId,dataClass,status,workflowKey:def.workflowKey,definitionHash:sha(def),contextHash:sha(cleanContext),path:Object.freeze([...path]),effects:Object.freeze([...effects]),wait,simulatedAt:new Date(this.#now()).toISOString()};return Object.freeze(result);
  }
}

export function compareWorkflowSimulations(before,after){
  if(!before||!after||before.tenantId!==after.tenantId||before.scenarioId!==after.scenarioId||before.contextHash!==after.contextHash)throw new Error('WORKFLOW_SIMULATION_COMPARISON_MISMATCH');
  const a=before.effects.map(x=>canonicalAuditPayload(x)),b=after.effects.map(x=>canonicalAuditPayload(x)),prefix=Math.min(a.length,b.length);let firstDifference=null;for(let i=0;i<prefix;i++)if(a[i]!==b[i]){firstDifference=i;break;}if(firstDifference===null&&a.length!==b.length)firstDifference=prefix;
  return Object.freeze({scenarioId:before.scenarioId,beforeDefinitionHash:before.definitionHash,afterDefinitionHash:after.definitionHash,beforeStatus:before.status,afterStatus:after.status,beforeEffectCount:a.length,afterEffectCount:b.length,pathChanged:canonicalAuditPayload(before.path)!==canonicalAuditPayload(after.path),waitChanged:canonicalAuditPayload(before.wait)!==canonicalAuditPayload(after.wait),firstEffectDifference:firstDifference});
}
