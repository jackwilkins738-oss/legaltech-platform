import crypto from 'node:crypto';
import {securityOptions,securityTransaction} from './postgresSecurityBoundary.js';
import {GRAPH_FUNCTION_HASHES} from './postgresGraphFunctionHashes.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
export const GRAPH_INBOX_EVENT_TYPES=Object.freeze(['CREATED','UPDATED','DELETED','MISSED','SUBSCRIPTION_REMOVED','REAUTHORIZATION_REQUIRED','UNKNOWN']);
const registered=new WeakSet();
const fail=code=>new Error(`GRAPH_INBOX_${code}`);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
export function graphInboxShape(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length
  ||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw fail('INPUT_INVALID');}
export function graphInboxUuid(v){if(typeof v!=='string'||!UUID.test(v))throw fail('INPUT_INVALID');return v;}
export function graphInboxHash(v){if(typeof v!=='string'||!HEX.test(v))throw fail('INPUT_INVALID');return v;}
function signalCheck(signal){if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw fail('INPUT_INVALID');}
const fields=['tenantId','subscriptionId','notificationFingerprint','sourceEvidenceHash','sourceVersionHash','eventType'];
function notification(v){graphInboxShape(v,fields);graphInboxUuid(v.tenantId);graphInboxUuid(v.subscriptionId);graphInboxHash(v.notificationFingerprint);graphInboxHash(v.sourceEvidenceHash);graphInboxHash(v.sourceVersionHash);if(!GRAPH_INBOX_EVENT_TYPES.includes(v.eventType))throw fail('INPUT_INVALID');return Object.freeze({...v});}
function view(row){
  if(!row)throw fail('UNVERIFIED');const value=notification({tenantId:row.tenant_id,subscriptionId:row.subscription_id,notificationFingerprint:row.notification_fingerprint,
    sourceEvidenceHash:row.source_evidence_hash,sourceVersionHash:row.source_version_hash,eventType:row.event_type});
  if(!['QUEUED','RUNNING','DONE','DEAD'].includes(row.status)||!Number.isInteger(row.attempts)||row.attempts<0||!Number.isInteger(row.max_attempts)
    ||row.max_attempts<1||row.max_attempts>10||row.attempts>row.max_attempts||!HEX.test(row.request_hash??''))throw fail('UNVERIFIED');
  return Object.freeze({...value,status:row.status,attempt:row.attempts,maxAttempts:row.max_attempts,requestHash:row.request_hash});
}
function claimInput(v,workerId){graphInboxShape(v,[...fields,'status','attempt','maxAttempts','requestHash','workerId','token']);notification(Object.fromEntries(fields.map(k=>[k,v[k]])));
  if(v.status!=='RUNNING'||v.workerId!==workerId||!Number.isInteger(v.attempt)||v.attempt<1||v.attempt>10||!Number.isInteger(v.maxAttempts)||v.maxAttempts<v.attempt||v.maxAttempts>10)throw fail('INPUT_INVALID');
  graphInboxHash(v.token);graphInboxHash(v.requestHash);return Object.freeze({...v});}
async function catalog(tx){
  const roles=(await tx.query("SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])",[['legaltech_graph_producer','legaltech_graph_worker','legaltech_graph_reader']])).rows;
  if(roles?.length!==3||roles.some(r=>['rolcanlogin','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(k=>r[k]!==false)))throw fail('UNVERIFIED');
  const tables=(await tx.query("SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,row_security_active(c.oid) AS active FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='graph_security' AND c.relkind IN ('r','p')")).rows;
  if(tables?.length!==2||!tables.some(r=>r.relname==='notifications')||!tables.some(r=>r.relname==='receipts')||tables.some(r=>r.enabled!==true||r.forced!==true||r.active!==true))throw fail('UNVERIFIED');
  const policies=(await tx.query("SELECT policyname,tablename,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='graph_security'")).rows;
  const expected={graph_notification_read:['notifications','SELECT',['legaltech_graph_producer','legaltech_graph_reader','legaltech_graph_worker']],graph_notification_insert:['notifications','INSERT',['legaltech_graph_producer']],graph_notification_work:['notifications','UPDATE',['legaltech_graph_worker']],graph_receipt_read:['receipts','SELECT',['legaltech_graph_producer','legaltech_graph_reader','legaltech_graph_worker']],graph_receipt_insert:['receipts','INSERT',['legaltech_graph_worker']]};
  const expr=v=>typeof v==='string'&&v.replaceAll('public.','').replace(/\s+/g,'')==='(tenant_id=app_current_tenant_id())';
  if(policies?.length!==5||new Set(policies.map(p=>p.policyname)).size!==5||policies.some(p=>{const e=expected[p.policyname];return !e||p.tablename!==e[0]||p.cmd!==e[1]||!Array.isArray(p.roles)||JSON.stringify([...p.roles].sort())!==JSON.stringify(e[2])||(p.cmd!=='INSERT'&&!expr(p.qual))||(p.cmd!=='SELECT'&&!expr(p.with_check))||p.cmd==='SELECT'&&p.with_check!==null||p.cmd==='INSERT'&&p.qual!==null;}))throw fail('UNVERIFIED');
  const functions=(await tx.query("SELECT p.proname,p.prosecdef,p.proconfig,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS source_hash,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='graph_security'")).rows;
  if(functions?.length!==3||new Set(functions.map(f=>f.proname)).size!==3||functions.some(f=>GRAPH_FUNCTION_HASHES[f.proname]!==f.source_hash||f.prosecdef!==false||f.public_execute!==false||!Array.isArray(f.proconfig)||f.proconfig.length!==1||f.proconfig[0]!=='search_path=pg_catalog'))throw fail('UNVERIFIED');
  const triggers=(await tx.query("SELECT t.tgname,t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred,p.proname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='graph_security' AND NOT t.tgisinternal")).rows;
  const names={graph_notification_transition:['notifications','protect_notification',false,23],graph_receipt_fence:['receipts','protect_receipt',false,31],graph_notification_completion:['notifications','verify_completion',true,17],graph_receipt_completion:['receipts','verify_completion',true,5]};
  if(triggers?.length!==4||new Set(triggers.map(t=>t.tgname)).size!==4||triggers.some(t=>{const e=names[t.tgname];return !e||t.relname!==e[0]||t.proname!==e[1]||!['O','A'].includes(t.tgenabled)||t.tgdeferrable!==e[2]||t.tginitdeferred!==e[2]||t.tgtype!==e[3];}))throw fail('UNVERIFIED');
}
class Boundary {
  constructor(options,group,authorize){if(typeof authorize!=='function')throw fail('CONFIGURATION_INVALID');this.options=securityOptions(options);this.group=group;this.authorize=authorize;}
  async run(binding,work,{signal,readOnly=false}={}){
    signalCheck(signal);let denied;
    try{return await securityTransaction(this.options,this.group,async tx=>{
      await catalog(tx);
      const check=async(phase,extra={})=>{if(tx.signal.aborted)throw fail('UNVERIFIED');try{if(await this.authorize(Object.freeze({...binding,...extra,phase,signal:tx.signal}))!==true){denied=fail('FORBIDDEN');throw denied;}}catch(error){denied??=fail('UNVERIFIED');throw error;}if(tx.signal.aborted)throw fail('UNVERIFIED');};
      await check('ADMIT');const result=await work(tx,check);await check('COMMIT');return result;
    },{context:{tenantId:binding.tenantId,actorId:binding.actorId},readOnly,signal});}catch(error){if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw fail('OUTCOME_UNKNOWN');throw denied??fail('UNVERIFIED');}
  }
  async probe({signal}={}){signalCheck(signal);try{return await securityTransaction(this.options,this.group,async tx=>{await catalog(tx);return Object.freeze({ok:!tx.signal.aborted,code:'GRAPH_INBOX_VERIFIED'});},{readOnly:true,signal});}catch{return Object.freeze({ok:false,code:'GRAPH_INBOX_UNVERIFIED'});}}
}
export class PostgresGraphInboxProducer {
  #boundary;#actor;#attempts;#maxQueued;
  constructor({actorId,authorizeEnqueue,maxAttempts=5,maxQueued=10000,...options}={}){this.#actor=graphInboxUuid(actorId);if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw fail('CONFIGURATION_INVALID');if(!Number.isInteger(maxQueued)||maxQueued<1||maxQueued>100000)throw fail('CONFIGURATION_INVALID');this.#maxQueued=maxQueued;this.#attempts=maxAttempts;this.#boundary=new Boundary(options,'legaltech_graph_producer',authorizeEnqueue);registered.add(this);Object.freeze(this);}
  async enqueueBatch(values,{signal}={}){
    if(!Array.isArray(values)||Object.getPrototypeOf(values)!==Array.prototype||values.length<1||values.length>100||Reflect.ownKeys(values).length!==values.length+1||Array.from({length:values.length},(_,i)=>i).some(i=>!Object.hasOwn(Object.getOwnPropertyDescriptor(values,String(i))??{},'value')))throw fail('INPUT_INVALID');const list=values.map(notification),tenantId=list[0].tenantId;
    if(list.some(v=>v.tenantId!==tenantId)||new Set(list.map(v=>`${v.subscriptionId}:${v.notificationFingerprint}`)).size!==list.length)throw fail('INPUT_INVALID');
    let conflict=false;
    try{return await this.#boundary.run({tenantId,actorId:this.#actor,operation:'ENQUEUE'},async(tx,check)=>{
      // Serial tenant admission bounds capacity and avoids conflicting batch lock order.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['graph-inbox-v132',tenantId])]);
      const receipts=[];
      for(const value of list){
        await check('DISPATCH',value);const requestHash=sha(JSON.stringify(['graph-inbox-v132',...fields.map(k=>value[k]),this.#attempts]));
        const args=[tenantId,value.subscriptionId,value.notificationFingerprint];
        const prior=(await tx.query('SELECT * FROM graph_security.notifications WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3',args)).rows;
        let row,replayed=prior.length===1;
        if(prior.length>1)throw fail('UNVERIFIED');
        if(replayed){row=prior[0];if(row.request_hash!==requestHash||fields.some(k=>view(row)[k]!==value[k])||row.max_attempts!==this.#attempts){conflict=true;throw fail('CONFLICT');}}
        else{const capacity=await tx.query("SELECT count(*)::integer AS pending FROM graph_security.notifications WHERE tenant_id=$1::uuid AND status IN ('QUEUED','RUNNING')",[tenantId]);if(capacity.rows?.length!==1||!Number.isInteger(capacity.rows[0].pending)||capacity.rows[0].pending>=this.#maxQueued)throw fail('UNVERIFIED');const inserted=await tx.query(`INSERT INTO graph_security.notifications(tenant_id,subscription_id,notification_fingerprint,source_evidence_hash,source_version_hash,event_type,request_hash,max_attempts) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8) RETURNING *`,[...args,value.sourceEvidenceHash,value.sourceVersionHash,value.eventType,requestHash,this.#attempts]);if(inserted.rows?.length!==1)throw fail('UNVERIFIED');row=inserted.rows[0];if(row.request_hash!==requestHash||view(row).status!=='QUEUED'||view(row).attempt!==0||fields.some(k=>view(row)[k]!==value[k]))throw fail('UNVERIFIED');}
        await check('SAVED',value);receipts.push(Object.freeze({...view(row),replayed}));
      }
      for(const value of list)await check('COMMIT_NOTIFICATION',value);
      return Object.freeze(receipts);
    },{signal});}catch(error){throw conflict?fail('CONFLICT'):error;}
  }
  probe(options){return this.#boundary.probe(options);}
}
export class PostgresGraphInboxWorker {
  #boundary;#worker;#actor;
  constructor({workerId,actorId,authorizeWorker,...options}={}){this.#worker=graphInboxUuid(workerId);this.#actor=graphInboxUuid(actorId);this.#boundary=new Boundary(options,'legaltech_graph_worker',authorizeWorker);registered.add(this);Object.freeze(this);}
  async claimNext({tenantId,signal}={}){
    graphInboxUuid(tenantId);const token=crypto.randomBytes(32).toString('hex');
    return this.#boundary.run({tenantId,actorId:this.#actor,workerId:this.#worker,operation:'CLAIM'},async(tx,check)=>{
      const selected=(await tx.query("SELECT * FROM graph_security.notifications WHERE tenant_id=$1::uuid AND status='QUEUED' ORDER BY created_at,subscription_id,notification_fingerprint LIMIT 1 FOR UPDATE SKIP LOCKED",[tenantId])).rows;
      if(selected.length===0)return null;if(selected.length!==1)throw fail('UNVERIFIED');const row=selected[0],before=view(row);await check('DISPATCH',before);
      const changed=await tx.query("UPDATE graph_security.notifications SET status='RUNNING',attempts=attempts+1,worker_id=$4::uuid,token_hash=$5,error_code=NULL WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3 AND status='QUEUED' RETURNING *",[tenantId,before.subscriptionId,before.notificationFingerprint,this.#worker,sha(token)]);
      if(changed.rows?.length!==1||changed.rows[0].worker_id!==this.#worker||changed.rows[0].token_hash!==sha(token))throw fail('UNVERIFIED');const after=view(changed.rows[0]);
      if(after.status!=='RUNNING'||after.attempt!==before.attempt+1||fields.some(k=>after[k]!==before[k])||after.requestHash!==before.requestHash||after.maxAttempts!==before.maxAttempts)throw fail('UNVERIFIED');
      await check('SAVED',after);return Object.freeze({...after,workerId:this.#worker,token});
    },{signal});
  }
  async assertCurrent(input,{signal}={}){
    const c=claimInput(input,this.#worker);return this.#boundary.run({...c,token:undefined,actorId:this.#actor,operation:'ASSERT_CURRENT'},async(tx,check)=>{
      const rows=(await tx.query("SELECT * FROM graph_security.notifications WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3 AND status='RUNNING' AND attempts=$4 AND worker_id=$5::uuid AND token_hash=$6 AND request_hash=$7",[c.tenantId,c.subscriptionId,c.notificationFingerprint,c.attempt,c.workerId,sha(c.token),c.requestHash])).rows;
      if(rows.length!==1||fields.some(k=>view(rows[0])[k]!==c[k]))throw fail('UNVERIFIED');await check('DISPATCH');return true;
    },{signal,readOnly:true});
  }
  async complete(input,{outcomeHash,signal}={}){
    const c=claimInput(input,this.#worker);graphInboxHash(outcomeHash);
    return this.#boundary.run({...c,token:undefined,actorId:this.#actor,operation:'COMPLETE'},async(tx,check)=>{
      const args=[c.tenantId,c.subscriptionId,c.notificationFingerprint,c.attempt,c.workerId,sha(c.token)];
      const rows=(await tx.query('SELECT * FROM graph_security.notifications WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3 FOR UPDATE',args.slice(0,3))).rows;
      if(rows.length!==1||fields.some(k=>view(rows[0])[k]!==c[k])||rows[0].request_hash!==c.requestHash||rows[0].attempts!==c.attempt||rows[0].worker_id!==c.workerId||rows[0].token_hash!==sha(c.token))throw fail('UNVERIFIED');await check('DISPATCH');
      const previous=(await tx.query('SELECT * FROM graph_security.receipts WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3',args.slice(0,3))).rows;
      if(previous.length){if(previous.length!==1||rows[0].status!=='DONE'||previous[0].attempt!==c.attempt||previous[0].worker_id!==c.workerId||previous[0].token_hash!==sha(c.token)||previous[0].outcome_hash!==outcomeHash)throw fail('UNVERIFIED');return true;}
      if(rows[0].status!=='RUNNING')throw fail('UNVERIFIED');
      await tx.query('INSERT INTO graph_security.receipts(tenant_id,subscription_id,notification_fingerprint,attempt,worker_id,token_hash,outcome_hash) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7)',[...args,outcomeHash]);
      const changed=await tx.query("UPDATE graph_security.notifications SET status='DONE',error_code=NULL WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3 AND status='RUNNING' AND attempts=$4 AND worker_id=$5::uuid AND token_hash=$6 RETURNING notification_fingerprint",args);
      if(changed.rows?.length!==1||changed.rows[0].notification_fingerprint!==c.notificationFingerprint)throw fail('UNVERIFIED');return true;
    },{signal});
  }
  async fail(input,{retryable=false,errorCode='DISPATCH_REJECTED',signal}={}){
    const c=claimInput(input,this.#worker);if(typeof retryable!=='boolean'||!['DISPATCH_RETRY','DISPATCH_REJECTED','DISPATCH_CANCELLED'].includes(errorCode))throw fail('INPUT_INVALID');
    return this.#boundary.run({...c,token:undefined,actorId:this.#actor,operation:'FAIL'},async(tx,check)=>{
      await check('DISPATCH');const changed=await tx.query("UPDATE graph_security.notifications SET status=CASE WHEN $7::boolean AND attempts<max_attempts THEN 'QUEUED' ELSE 'DEAD' END,worker_id=NULL,token_hash=NULL,error_code=$8 WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3 AND status='RUNNING' AND attempts=$4 AND worker_id=$5::uuid AND token_hash=$6 AND request_hash=$9 RETURNING notification_fingerprint",[c.tenantId,c.subscriptionId,c.notificationFingerprint,c.attempt,c.workerId,sha(c.token),retryable,errorCode,c.requestHash]);
      if(changed.rows?.length!==1||changed.rows[0].notification_fingerprint!==c.notificationFingerprint)throw fail('UNVERIFIED');return true;
    },{signal});
  }
  probe(options){return this.#boundary.probe(options);}
}
export class PostgresGraphInboxReader {
  #boundary;#actor;
  constructor({actorId,authorizeRead,...options}={}){this.#actor=graphInboxUuid(actorId);this.#boundary=new Boundary(options,'legaltech_graph_reader',authorizeRead);registered.add(this);Object.freeze(this);}
  async get(input,{signal}={}){graphInboxShape(input,['tenantId','subscriptionId','notificationFingerprint']);graphInboxUuid(input.tenantId);graphInboxUuid(input.subscriptionId);graphInboxHash(input.notificationFingerprint);
    return this.#boundary.run({...input,actorId:this.#actor,operation:'READ'},async(tx,check)=>{const rows=(await tx.query('SELECT * FROM graph_security.notifications WHERE tenant_id=$1::uuid AND subscription_id=$2::uuid AND notification_fingerprint=$3',[input.tenantId,input.subscriptionId,input.notificationFingerprint])).rows;if(rows.length>1)throw fail('UNVERIFIED');if(!rows.length)return null;const v=view(rows[0]);await check('DISPATCH',v);return v;},{signal,readOnly:true});
  }
  probe(options){return this.#boundary.probe(options);}
}
export const isPostgresGraphInbox=value=>registered.has(value);
