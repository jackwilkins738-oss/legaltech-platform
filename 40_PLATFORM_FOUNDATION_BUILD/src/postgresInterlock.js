import crypto from 'node:crypto';
import {exactLifecycleRecord} from './lifecycleTransition.js';
import {SECURITY_INTERLOCK_CONTROLS} from './securityInterlock.js';
import {securityOptions,securityTransaction,securityProbe} from './postgresSecurityBoundary.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SAFE=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const controls=new Set(SECURITY_INTERLOCK_CONTROLS);
const egress=new Set(['PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY']);
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw new Error('SECURITY_INTERLOCK_REQUEST_INVALID');return v.toLowerCase();}
function control(v){if(!controls.has(v))throw new Error('SECURITY_INTERLOCK_CONTROL_INVALID');return v;}
function safe(v,pattern=SAFE){if(typeof v!=='string'||!pattern.test(v))throw new Error('SECURITY_INTERLOCK_REQUEST_INVALID');return v;}
function shape(input,keys){exactLifecycleRecord(input,keys,'SECURITY_INTERLOCK_REQUEST_INVALID');}
function view(row){return Object.freeze({id:row.id,tenantId:row.tenant_id,control:row.control,status:row.status,incidentId:row.incident_id,reasonCode:row.reason_code,activatedBy:row.activated_by,activatedAt:new Date(row.activated_at).toISOString(),releasedBy:row.released_by,releasedAt:row.released_at?new Date(row.released_at).toISOString():null,resolutionCode:row.resolution_code});}
const reader='legaltech_security_reader',operator='legaltech_security_operator';

// Reader and operator are separate objects/pools. Never give mutation credentials to API workers.
export class PostgresSecurityInterlock {
  #options;
  constructor(options){this.#options=securityOptions(options);}
  async status(tenantId,{signal}={}) {
    tenantId=uuid(tenantId);
    try{return await securityTransaction(this.#options,reader,async tx=>{
      const result=await tx.query("SELECT control FROM operational_security.interlocks WHERE tenant_id=$1::uuid AND status='ACTIVE' ORDER BY control",[tenantId]);
      return Object.freeze({tenantId,activeControls:Object.freeze(result.rows.map(x=>control(x.control)))});
    },{readOnly:true,signal});}catch{throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');}
  }
  async assertAllowed({tenantId,operation,signal}={}) {
    operation=control(operation);
    const state=await this.status(tenantId,{signal});
    if(state.activeControls.includes(operation)||(egress.has(operation)&&state.activeControls.includes('ALL_EGRESS')))throw new Error('SECURITY_INTERLOCK_ACTIVE');
    return true;
  }
  async probe(){try{return await securityProbe(this.#options,reader);}catch{throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');}}
}

export class PostgresSecurityInterlockOperator {
  #options;#authorize;
  constructor({authorizeChange,...options}={}){if(typeof authorizeChange!=='function')throw new Error('SHARED_SECURITY_CONFIGURATION_INVALID');this.#options=securityOptions(options);this.#authorize=authorizeChange;}
  async #change(input,release) {
    shape(input,release?['tenantId','control','interlockId','incidentId','actorId','traceId','resolutionCode']:['tenantId','control','actorId','traceId','incidentId','reasonCode']);
    const tenantId=uuid(input.tenantId),actorId=uuid(input.actorId),kind=control(input.control),traceId=safe(input.traceId);
    const interlockId=release?uuid(input.interlockId):null,incidentId=safe(input.incidentId),reasonCode=release?null:safe(input.reasonCode,CODE),resolutionCode=release?safe(input.resolutionCode,CODE):null;
    let domainError;
    try{return await securityTransaction(this.#options,operator,async tx=>{
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['interlock',tenantId,kind])]);
      const result=await tx.query('SELECT * FROM operational_security.interlocks WHERE tenant_id=$1::uuid AND control=$2 FOR UPDATE',[tenantId,kind]);
      if(!Array.isArray(result.rows)||result.rows.length>1)throw new Error('SECURITY_INTERLOCK_RECEIPT_INVALID');
      const prior=result.rows[0];
      if(release&&prior&&(prior.tenant_id!==tenantId||prior.control!==kind||!['ACTIVE','RELEASED'].includes(prior.status)))throw new Error('SECURITY_INTERLOCK_RECEIPT_INVALID');
      if(release&&prior&&(prior.id!==interlockId||prior.incident_id!==incidentId)){domainError=new Error('SECURITY_INTERLOCK_RELEASE_STALE');throw domainError;}
      let authorized=false;
      try{authorized=await this.#authorize(Object.freeze({tenantId,actorId,control:kind,action:release?'RELEASE':'ACTIVATE',incidentId,...(release?{interlockId,resolutionCode}:{}),signal:tx.signal}))===true;}catch{domainError=new Error('SECURITY_INTERLOCK_AUTHORIZATION_UNAVAILABLE');throw domainError;}
      if(!authorized){domainError=new Error('SECURITY_INTERLOCK_FORBIDDEN');throw domainError;}
      if(release){
        if(!prior){domainError=new Error('SECURITY_INTERLOCK_UNAVAILABLE');throw domainError;}
        if(prior.status==='RELEASED'){if(prior.released_by!==actorId||prior.resolution_code!==resolutionCode){domainError=new Error('SECURITY_INTERLOCK_RELEASE_REPLAY_MISMATCH');throw domainError;}return Object.freeze({...view(prior),replayed:true});}
        if(prior.activated_by===actorId){domainError=new Error('SECURITY_INTERLOCK_DUAL_CONTROL_REQUIRED');throw domainError;}
        const changed=await tx.query("UPDATE operational_security.interlocks SET status='RELEASED',released_by=$3::uuid,released_at=clock_timestamp(),resolution_code=$4,trace_id=$5 WHERE tenant_id=$1::uuid AND control=$2 AND id=$6::uuid AND incident_id=$7 AND status='ACTIVE' RETURNING *",[tenantId,kind,actorId,resolutionCode,traceId,interlockId,incidentId]);
        const row=changed.rows?.[0];if(changed.rows?.length!==1||row.id!==interlockId||row.incident_id!==incidentId||row.tenant_id!==tenantId||row.control!==kind||row.status!=='RELEASED'||row.released_by!==actorId||row.resolution_code!==resolutionCode)throw new Error('SECURITY_INTERLOCK_RELEASE_UNVERIFIED');
        return Object.freeze({...view(row),replayed:false});
      }
      if(prior?.status==='ACTIVE'){
        if(prior.incident_id===incidentId&&prior.reason_code===reasonCode)return Object.freeze({...view(prior),replayed:true});
        domainError=new Error('SECURITY_INTERLOCK_ALREADY_ACTIVE');throw domainError;
      }
      const changed=await tx.query(`INSERT INTO operational_security.interlocks
        (tenant_id,control,id,status,incident_id,reason_code,activated_by,activated_at,trace_id)
        VALUES ($1::uuid,$2,$3::uuid,'ACTIVE',$4,$5,$6::uuid,clock_timestamp(),$7)
        ON CONFLICT (tenant_id,control) DO UPDATE SET id=EXCLUDED.id,status='ACTIVE',incident_id=EXCLUDED.incident_id,
          reason_code=EXCLUDED.reason_code,activated_by=EXCLUDED.activated_by,activated_at=EXCLUDED.activated_at,
          trace_id=EXCLUDED.trace_id,released_by=NULL,released_at=NULL,resolution_code=NULL RETURNING *`,[tenantId,kind,crypto.randomUUID(),incidentId,reasonCode,actorId,traceId]);
      return Object.freeze({...view(changed.rows[0]),replayed:false});
    });}catch(error){if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('SECURITY_INTERLOCK_OUTCOME_UNKNOWN');throw domainError??new Error('SECURITY_INTERLOCK_UNAVAILABLE');}
  }
  activate(input){return this.#change(input,false);}
  release(input){return this.#change(input,true);}
  async probe(){try{return await securityProbe(this.#options,operator);}catch{throw new Error('SECURITY_INTERLOCK_UNAVAILABLE');}}
}
