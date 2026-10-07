import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const clone = (x) => x == null ? x : JSON.parse(JSON.stringify(x));

export class SQLiteStore {
  constructor(filename=':memory:', seed={}) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS matters (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_reference TEXT,
        proclaim_id TEXT,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matters_tenant ON matters(tenant_id);
      CREATE TABLE IF NOT EXISTS matter_refs (
        tenant_id TEXT NOT NULL,
        matter_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        PRIMARY KEY (tenant_id, matter_id, ref),
        FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_matter_refs_lookup ON matter_refs(tenant_id, ref);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exceptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audits (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        tenant_id TEXT NOT NULL,
        at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audits_tenant ON audits(tenant_id, seq);
      CREATE TABLE IF NOT EXISTS idempotency (
        scope TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, available_at, created_at);
    `);
    this.seedIfEmpty(seed);
  }

  close() { this.db.close(); }
  uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

  seedIfEmpty(seed={}) {
    const count=Number(this.db.prepare('SELECT COUNT(*) c FROM matters').get().c);
    if(count>0) return;
    this.db.exec('BEGIN');
    try {
      for (const m of seed.matters || []) this.insertMatter(m);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  reset(seed={}) {
    this.db.exec('BEGIN');
    try {
      for (const table of ['matter_refs','events','exceptions','audits','idempotency','jobs','matters']) this.db.exec(`DELETE FROM ${table}`);
      for (const m of seed.matters || []) this.insertMatter(m);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  insertMatter(m) {
    this.db.prepare('INSERT INTO matters(id,tenant_id,display_reference,proclaim_id,data_json) VALUES(?,?,?,?,?)')
      .run(m.id,m.tenantId,m.displayReference||null,m.proclaimId||null,JSON.stringify(m));
    const st=this.db.prepare('INSERT INTO matter_refs(tenant_id,matter_id,ref) VALUES(?,?,?)');
    for (const ref of m.externalRefs || []) st.run(m.tenantId,m.id,ref);
  }

  listTenantMatters(tenantId) {
    return this.db.prepare('SELECT data_json FROM matters WHERE tenant_id=? ORDER BY id').all(tenantId).map(r=>JSON.parse(r.data_json));
  }

  getMatter(tenantId,matterId) {
    const r=this.db.prepare('SELECT data_json FROM matters WHERE tenant_id=? AND id=?').get(tenantId,matterId);
    return r ? JSON.parse(r.data_json) : null;
  }

  findMatterByExternalRef(tenantId,ref) {
    return this.db.prepare(`SELECT m.data_json FROM matter_refs r JOIN matters m ON m.id=r.matter_id WHERE r.tenant_id=? AND r.ref=? AND m.tenant_id=?`)
      .all(tenantId,ref,tenantId).map(r=>JSON.parse(r.data_json));
  }

  putEvent(event) { this.db.prepare('INSERT INTO events(id,tenant_id,data_json) VALUES(?,?,?)').run(event.id,event.tenantId,JSON.stringify(event)); }
  eventCount() { return Number(this.db.prepare('SELECT COUNT(*) c FROM events').get().c); }

  putException(ex) { this.db.prepare('INSERT INTO exceptions(id,tenant_id,status,data_json) VALUES(?,?,?,?)').run(ex.id,ex.tenantId,ex.status,JSON.stringify(ex)); }
  getException(tenantId,id) {
    const r=this.db.prepare('SELECT data_json FROM exceptions WHERE tenant_id=? AND id=?').get(tenantId,id);
    return r ? JSON.parse(r.data_json) : null;
  }
  updateException(ex) { this.db.prepare('UPDATE exceptions SET status=?,data_json=? WHERE id=? AND tenant_id=?').run(ex.status,JSON.stringify(ex),ex.id,ex.tenantId); }
  listExceptions(tenantId) { return this.db.prepare('SELECT data_json FROM exceptions WHERE tenant_id=? ORDER BY rowid').all(tenantId).map(r=>JSON.parse(r.data_json)); }

  audit(entry) {
    const item={id:this.uid('aud'),at:new Date().toISOString(),...entry};
    this.db.prepare('INSERT INTO audits(id,tenant_id,at,data_json) VALUES(?,?,?,?)').run(item.id,item.tenantId,item.at,JSON.stringify(item));
    return clone(item);
  }
  listAudits(tenantId) { return this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq').all(tenantId).map(r=>JSON.parse(r.data_json)); }

  getIdempotent(scope) { const r=this.db.prepare('SELECT data_json FROM idempotency WHERE scope=?').get(scope); return r?JSON.parse(r.data_json):null; }
  setIdempotent(scope,value) { this.db.prepare('INSERT OR REPLACE INTO idempotency(scope,data_json) VALUES(?,?)').run(scope,JSON.stringify(value)); }

  enqueue({tenantId,type,payload,availableAt=new Date().toISOString()}) {
    const now=new Date().toISOString(); const id=this.uid('job');
    this.db.prepare('INSERT INTO jobs(id,tenant_id,type,status,attempts,available_at,payload_json,created_at,updated_at) VALUES(?,?,?,\'QUEUED\',0,?,?,?,?)')
      .run(id,tenantId,type,availableAt,JSON.stringify(payload),now,now);
    return {id,tenantId,type,status:'QUEUED',attempts:0,availableAt,payload:clone(payload)};
  }
  claimNext() {
    const now=new Date().toISOString();
    const row=this.db.prepare("SELECT * FROM jobs WHERE status='QUEUED' AND available_at<=? ORDER BY created_at LIMIT 1").get(now);
    if(!row) return null;
    const changed=this.db.prepare("UPDATE jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND status='QUEUED'").run(now,row.id);
    if(Number(changed.changes)!==1) return null;
    return this.getJob(row.id);
  }
  getJob(id) {
    const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if(!r) return null;
    return {id:r.id,tenantId:r.tenant_id,type:r.type,status:r.status,attempts:Number(r.attempts),availableAt:r.available_at,payload:JSON.parse(r.payload_json),lastError:r.last_error};
  }
  completeJob(id) { this.db.prepare("UPDATE jobs SET status='DONE',updated_at=? WHERE id=?").run(new Date().toISOString(),id); return this.getJob(id); }
  failJob(id,error,{retry=true,delayMs=1000}={}) {
    const status=retry?'QUEUED':'DEAD';
    const available=new Date(Date.now()+delayMs).toISOString();
    this.db.prepare('UPDATE jobs SET status=?,available_at=?,last_error=?,updated_at=? WHERE id=?').run(status,available,String(error),new Date().toISOString(),id);
    return this.getJob(id);
  }
  listJobs(tenantId) {
    return this.db.prepare('SELECT * FROM jobs WHERE tenant_id=? ORDER BY created_at').all(tenantId).map(r=>({id:r.id,tenantId:r.tenant_id,type:r.type,status:r.status,attempts:Number(r.attempts),availableAt:r.available_at,payload:JSON.parse(r.payload_json),lastError:r.last_error}));
  }
}
