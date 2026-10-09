import crypto from 'node:crypto';
import net from 'node:net';
import {appError} from './errors.js';
import {securityOptions,securityTransaction,securityProbe} from './postgresSecurityBoundary.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const group='legaltech_rate_limiter';
function context(value){if(typeof value!=='string'||!UUID.test(value))throw new Error('RATE_LIMIT_CONTEXT_INVALID');return value.toLowerCase();}
function integer(v,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error('SHARED_RATE_CONFIGURATION_INVALID');return v;}
export class PostgresAbuseLimiter {
  #options;#key;#window;#ip;#tenant;#records;#matters;#fingerprint;
  constructor({hashKey,windowMs=60000,maxPerIp=300,maxPerTenant=1000,maxReadRecordsPerActor=10000,maxDistinctMattersPerActor=2000,...options}={}) {
    this.#options=securityOptions(options);
    if(!Buffer.isBuffer(hashKey)||hashKey.length<32||hashKey.length>128)throw new Error('SHARED_RATE_CONFIGURATION_INVALID');
    this.#key=Buffer.from(hashKey);this.#window=integer(windowMs,1000,3600000);
    this.#ip=integer(maxPerIp,1,1000000);this.#tenant=integer(maxPerTenant,1,1000000);
    this.#records=integer(maxReadRecordsPerActor,1,1000000);this.#matters=integer(maxDistinctMattersPerActor,1,100000);
    this.#fingerprint=this.#hash(['configuration-v119',this.#window,this.#ip,this.#tenant,this.#records,this.#matters]);
  }
  #hash(value){return crypto.createHmac('sha256',this.#key).update(JSON.stringify(value)).digest('hex');}
  async #configuration(tx){
    const result=await tx.query('SELECT fingerprint FROM operational_security.rate_configuration WHERE singleton=true');
    if(result.rows.length!==1||result.rows[0].fingerprint!==this.#fingerprint)throw new Error('SHARED_RATE_CONFIGURATION_DRIFT');
  }
  async initialize(){
    try{return await securityTransaction(this.#options,group,async tx=>{
      await tx.query('INSERT INTO operational_security.rate_configuration(singleton,fingerprint) VALUES(true,$1) ON CONFLICT DO NOTHING',[this.#fingerprint]);
      await this.#configuration(tx);return true;
    });}catch{throw new Error('SHARED_RATE_INITIALIZATION_UNAVAILABLE');}
  }
  async #consume(scope,identity,count,limit,matterIds=[],matterLimit=0) {
    const bucket=this.#hash(['bucket',scope,...identity]);
    // Deduplicate before sending bounded opaque hashes to PostgreSQL. No legal IDs/IPs persist.
    const matters=[...new Set(matterIds.map(id=>this.#hash(['matter',...identity,id])))];
    let denied=false;
    try {
      await securityTransaction(this.#options,group,async tx=>{
        await this.#configuration(tx);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`rate:${bucket}`]);
        const found=await tx.query('SELECT *,clock_timestamp() AS database_now FROM operational_security.rate_buckets WHERE bucket_hash=$1 FOR UPDATE',[bucket]);
        let row=found.rows[0];
        if(row&&(row.window_ms!==this.#window||row.record_limit!==limit||row.matter_limit!==matterLimit||row.scope!==scope))throw new Error('SHARED_RATE_CONFIGURATION_DRIFT');
        if(!row){
          const inserted=await tx.query(`INSERT INTO operational_security.rate_buckets(bucket_hash,scope,window_ms,record_limit,matter_limit,window_id,started_at,records)
            VALUES ($1,$2,$3,$4,$5,$6::uuid,clock_timestamp(),0) RETURNING *,clock_timestamp() AS database_now`,[bucket,scope,this.#window,limit,matterLimit,crypto.randomUUID()]);
          row=inserted.rows[0];
        }
        const now=new Date(row.database_now).getTime(),started=new Date(row.started_at).getTime();
        if(!Number.isFinite(now)||!Number.isFinite(started)||now<started)throw new Error('SHARED_RATE_CLOCK_INVALID');
        if(now-started>=this.#window){
          await tx.query('DELETE FROM operational_security.read_matters WHERE bucket_hash=$1',[bucket]);
          const reset=await tx.query('UPDATE operational_security.rate_buckets SET window_id=$2::uuid,started_at=clock_timestamp(),records=0 WHERE bucket_hash=$1 RETURNING *',[bucket,crypto.randomUUID()]);row=reset.rows[0];
        }
        const records=Number(row.records);
        if(!Number.isSafeInteger(records)||records<0||records>limit)throw new Error('SHARED_RATE_STATE_INVALID');
        if(records+count>limit){denied=true;throw new Error('SHARED_RATE_DENIED');}
        if(matterLimit>0){
          const total=await tx.query(`SELECT count(*)::integer AS total FROM (
            SELECT matter_hash FROM operational_security.read_matters WHERE bucket_hash=$1 AND window_id=$2::uuid
            UNION SELECT unnest($3::text[]) AS matter_hash) x`,[bucket,row.window_id,matters]);
          if(total.rows.length!==1||!Number.isInteger(total.rows[0].total)||total.rows[0].total<0)throw new Error('SHARED_RATE_STATE_INVALID');
          if(total.rows[0].total>matterLimit){denied=true;throw new Error('SHARED_RATE_DENIED');}
          await tx.query(`INSERT INTO operational_security.read_matters(bucket_hash,window_id,matter_hash)
            SELECT $1,$2::uuid,unnest($3::text[]) ON CONFLICT DO NOTHING`,[bucket,row.window_id,matters]);
        }
        await tx.query('UPDATE operational_security.rate_buckets SET records=records+$2::integer WHERE bucket_hash=$1',[bucket,count]);
      });
      return true;
    } catch(error) {
      // Even an uncertain COMMIT never returns permission to serve this request.
      if(denied&&error.message!=='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw appError('request volume limit exceeded',{status:429,code:scope==='READ'?'READ_VOLUME_LIMITED':'RATE_LIMITED'});
      throw appError('shared rate limit unavailable',{status:503,code:'RATE_LIMIT_STORE_UNAVAILABLE'});
    }
  }
  checkIp(req) {
    let address=req?.socket?.remoteAddress;
    if(typeof address!=='string'||!net.isIP(address))throw appError('invalid network context',{status:503,code:'RATE_LIMIT_STORE_UNAVAILABLE'});
    address=address.toLowerCase();if(address.startsWith('::ffff:')&&net.isIP(address.slice(7))===4)address=address.slice(7);
    // Never trust client-controlled X-Forwarded-For. Resolve a trusted proxy at the ingress.
    return this.#consume('IP',[address],1,this.#ip);
  }
  checkTenant(session){return this.#consume('TENANT',[context(session?.tenantId)],1,this.#tenant);}
  checkRead(session,{resource,count=0,matterIds=[]}={}) {
    const tenantId=context(session?.tenantId),actorId=context(session?.actorId);
    if(typeof resource!=='string'||!/^[a-z0-9:-]{1,64}$/.test(resource)||!Number.isSafeInteger(count)||count<0||count>10000||!Array.isArray(matterIds)||matterIds.length>10000
      ||matterIds.some(id=>typeof id!=='string'||!id||id.length>256||/[\u0000-\u001f\u007f]/.test(id)))throw new Error('READ_BUDGET_CONTEXT_INVALID');
    // Resources share an actor budget; changing endpoint names cannot reset it.
    return this.#consume('READ',[tenantId,actorId],count,this.#records,matterIds,this.#matters);
  }
  async probe(){try{
    await securityProbe(this.#options,group);
    return await securityTransaction(this.#options,group,async tx=>{await this.#configuration(tx);return Object.freeze({ok:true});},{readOnly:true});
  }catch{throw new Error('RATE_LIMIT_STORE_UNAVAILABLE');}}
}
