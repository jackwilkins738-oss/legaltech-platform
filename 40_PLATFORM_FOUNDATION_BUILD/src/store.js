import crypto from 'node:crypto'; import {DatabaseSync} from 'node:sqlite';
const json=x=>JSON.stringify(x); const parse=x=>x?JSON.parse(x):null;
export class PlatformStore {
  constructor(filename=':memory:',seed={}){this.db=new DatabaseSync(filename);this.#migrate();this.#seed(seed);}
  close(){this.db.close();} uid(p){return `${p}_${crypto.randomUUID()}`;}
  #migrate(){this.db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS matters(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,external_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS matters_tenant ON matters(tenant_id);
    CREATE TABLE IF NOT EXISTS matter_refs(tenant_id TEXT NOT NULL,matter_id TEXT NOT NULL,ref TEXT NOT NULL,PRIMARY KEY(tenant_id,matter_id,ref),FOREIGN KEY(matter_id) REFERENCES matters(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS matter_refs_lookup ON matter_refs(tenant_id,ref);
    CREATE TABLE IF NOT EXISTS inbound_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL,trace_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS inbound_tenant ON inbound_events(tenant_id);
    CREATE TABLE IF NOT EXISTS exceptions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL,event_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS exceptions_tenant ON exceptions(tenant_id,status);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,payload_json TEXT NOT NULL,last_error TEXT,trace_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status,available_at,created_at);
    CREATE TABLE IF NOT EXISTS idempotency(scope TEXT PRIMARY KEY,data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audits(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,at TEXT NOT NULL,trace_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audits_tenant ON audits(tenant_id,seq);
  `);}
  #seed(seed){const n=Number(this.db.prepare('SELECT COUNT(*) c FROM matters').get().c);if(n)return;for(const m of seed.matters||[])this.insertMatter(m);}
  insertMatter(m){this.db.prepare('INSERT INTO matters(id,tenant_id,external_id,data_json) VALUES(?,?,?,?)').run(m.id,m.tenantId,m.externalId,json(m));const st=this.db.prepare('INSERT INTO matter_refs(tenant_id,matter_id,ref) VALUES(?,?,?)');for(const ref of m.externalRefs||[])st.run(m.tenantId,m.id,ref);}
  getMatter(t,id){const r=this.db.prepare('SELECT data_json FROM matters WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  findMatterByExternalRef(t,ref){return this.db.prepare('SELECT m.data_json FROM matter_refs r JOIN matters m ON m.id=r.matter_id WHERE r.tenant_id=? AND r.ref=? AND m.tenant_id=?').all(t,ref,t).map(r=>parse(r.data_json));}
  putEvent(e){this.db.prepare('INSERT INTO inbound_events(id,tenant_id,status,trace_id,data_json) VALUES(?,?,?,?,?)').run(e.id,e.tenantId,e.status,e.traceId,json(e));}
  updateEvent(e){this.db.prepare('UPDATE inbound_events SET status=?,data_json=? WHERE id=? AND tenant_id=?').run(e.status,json(e),e.id,e.tenantId);}
  getEvent(t,id){const r=this.db.prepare('SELECT data_json FROM inbound_events WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  countEvents(t){return Number(this.db.prepare('SELECT COUNT(*) c FROM inbound_events WHERE tenant_id=?').get(t).c);}
  listEvents(t,limit=50){return this.db.prepare('SELECT data_json FROM inbound_events WHERE tenant_id=? ORDER BY rowid DESC LIMIT ?').all(t,Math.max(1,Math.min(Number(limit)||50,200))).map(r=>parse(r.data_json));}
  listMatters(t,limit=100){return this.db.prepare('SELECT data_json FROM matters WHERE tenant_id=? ORDER BY rowid LIMIT ?').all(t,Math.max(1,Math.min(Number(limit)||100,500))).map(r=>parse(r.data_json));}
  putException(e){this.db.prepare('INSERT INTO exceptions(id,tenant_id,status,event_id,data_json) VALUES(?,?,?,?,?)').run(e.id,e.tenantId,e.status,e.eventId,json(e));}
  updateException(e){this.db.prepare('UPDATE exceptions SET status=?,data_json=? WHERE id=? AND tenant_id=?').run(e.status,json(e),e.id,e.tenantId);}
  getException(t,id){const r=this.db.prepare('SELECT data_json FROM exceptions WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  listExceptions(t,status){const q=status?'SELECT data_json FROM exceptions WHERE tenant_id=? AND status=? ORDER BY rowid':'SELECT data_json FROM exceptions WHERE tenant_id=? ORDER BY rowid';const rs=status?this.db.prepare(q).all(t,status):this.db.prepare(q).all(t);return rs.map(r=>parse(r.data_json));}
  enqueue({tenantId,type,payload,traceId,availableAt=new Date().toISOString()}){const id=this.uid('job'),now=new Date().toISOString();this.db.prepare("INSERT INTO jobs(id,tenant_id,type,status,attempts,available_at,payload_json,trace_id,created_at,updated_at) VALUES(?,?,?,'QUEUED',0,?,?,?,?,?)").run(id,tenantId,type,availableAt,json(payload),traceId,now,now);return this.getJob(id);}
  getJob(id){const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return r?{id:r.id,tenantId:r.tenant_id,type:r.type,status:r.status,attempts:Number(r.attempts),availableAt:r.available_at,payload:parse(r.payload_json),lastError:r.last_error,traceId:r.trace_id}:null;}
  claimNext(type=null){const now=new Date().toISOString();const r=type?this.db.prepare("SELECT id FROM jobs WHERE status='QUEUED' AND type=? AND available_at<=? ORDER BY created_at LIMIT 1").get(type,now):this.db.prepare("SELECT id FROM jobs WHERE status='QUEUED' AND available_at<=? ORDER BY created_at LIMIT 1").get(now);if(!r)return null;const c=this.db.prepare("UPDATE jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND status='QUEUED'").run(now,r.id);return Number(c.changes)===1?this.getJob(r.id):null;}
  completeJob(id){this.db.prepare("UPDATE jobs SET status='DONE',updated_at=? WHERE id=?").run(new Date().toISOString(),id);return this.getJob(id);}
  failJob(id,error,{retry=true,delayMs=0}={}){const state=retry?'QUEUED':'DEAD';this.db.prepare('UPDATE jobs SET status=?,available_at=?,last_error=?,updated_at=? WHERE id=?').run(state,new Date(Date.now()+delayMs).toISOString(),String(error),new Date().toISOString(),id);return this.getJob(id);}
  getIdempotent(scope){const r=this.db.prepare('SELECT data_json FROM idempotency WHERE scope=?').get(scope);return parse(r?.data_json);}
  setIdempotent(scope,value){this.db.prepare('INSERT OR REPLACE INTO idempotency(scope,data_json) VALUES(?,?)').run(scope,json(value));}
  audit({tenantId,traceId,...entry}){const item={id:this.uid('aud'),at:new Date().toISOString(),tenantId,traceId,...entry};this.db.prepare('INSERT INTO audits(id,tenant_id,at,trace_id,data_json) VALUES(?,?,?,?,?)').run(item.id,tenantId,item.at,traceId,json(item));return item;}
  listAudits(t){return this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq').all(t).map(r=>parse(r.data_json));}
}
