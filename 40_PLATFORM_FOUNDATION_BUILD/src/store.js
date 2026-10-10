import crypto from 'node:crypto'; import {DatabaseSync} from 'node:sqlite';
import {auditEntryHash,verifyAuditChainEntries} from './securityMonitoring.js';
const json=x=>JSON.stringify(x); const parse=x=>x?JSON.parse(x):null;
const readJobAttempts=value=>typeof value==='bigint'?(Number.isSafeInteger(Number(value))?Number(value):NaN):typeof value==='number'?value:NaN;
export class PlatformStore {
  constructor(filename=':memory:',seed={}){this.db=new DatabaseSync(filename);this.securityMonitor=null;this.#migrate();this.#seed(seed);}
  attachSecurityMonitor(monitor){if(!monitor||typeof monitor.observeAudit!=='function')throw new Error('invalid security monitor');this.securityMonitor=monitor;return monitor;}
  transaction(run) {
    const name = `sp_${crypto.randomUUID().replaceAll('-', '')}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = run();
      if (result && typeof result.then === 'function') throw new Error('store transactions must be synchronous');
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }
  recoverExpiredPolicyEvaluationJobs({leaseMs = 300000, tenantId = null} = {}) {
    if (!Number.isFinite(leaseMs) || leaseMs < 1000) throw new Error('invalid worker lease');
    const now = new Date().toISOString(), before = new Date(Date.now() - leaseMs).toISOString();
    let query = "UPDATE jobs SET status='QUEUED',available_at=?,updated_at=? WHERE type='WORK_POLICY_EVALUATION' AND status='RUNNING' AND updated_at<=?", args=[now,now,before];
    if (tenantId !== null) { query += ' AND tenant_id=?'; args.push(tenantId); }
    return Number(this.db.prepare(query).run(...args).changes);
  }
  recoverExpiredWritebackJobs({leaseMs = 300000, tenantId = null, eventId = null} = {}) {
    if (!Number.isFinite(leaseMs) || leaseMs < 1000) throw new Error('invalid worker lease');
    const now = new Date().toISOString();
    const before = new Date(Date.now() - leaseMs).toISOString();
    const query = "UPDATE jobs SET status='QUEUED',available_at=?,updated_at=? WHERE type='PROCLAIM_WRITEBACK' AND status='RUNNING' AND updated_at<=?";
    const args = [now, now, before];
    let filters = '';
    if (tenantId !== null) { filters += ' AND tenant_id=?'; args.push(tenantId); }
    if (eventId !== null) { filters += " AND json_extract(payload_json,'$.eventId')=?"; args.push(eventId); }
    return Number(this.db.prepare(query + filters).run(...args).changes);
  }
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
    CREATE TABLE IF NOT EXISTS audit_checkpoints(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,audit_count INTEGER NOT NULL,head_hash TEXT NOT NULL,checkpoint_hash TEXT NOT NULL,anchor_ref_hash TEXT,created_at TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,checkpoint_hash));
    CREATE INDEX IF NOT EXISTS audit_checkpoints_tenant ON audit_checkpoints(tenant_id,audit_count,created_at);
    CREATE TABLE IF NOT EXISTS security_alerts(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,at TEXT NOT NULL,trace_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS security_alerts_tenant ON security_alerts(tenant_id,seq);
    CREATE TABLE IF NOT EXISTS recovery_evidence(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,at TEXT NOT NULL,trace_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS recovery_evidence_tenant ON recovery_evidence(tenant_id,seq);
    CREATE TABLE IF NOT EXISTS work_items(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,matter_id TEXT,status TEXT NOT NULL,type TEXT NOT NULL,owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,priority INTEGER NOT NULL,due_at TEXT,version INTEGER NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS work_items_queue ON work_items(tenant_id,status,owner_kind,owner_id,priority,due_at);
    CREATE INDEX IF NOT EXISTS work_items_matter ON work_items(tenant_id,matter_id);
    CREATE TABLE IF NOT EXISTS work_dependencies(tenant_id TEXT NOT NULL,work_id TEXT NOT NULL,depends_on_work_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,data_json TEXT NOT NULL,PRIMARY KEY(tenant_id,work_id,depends_on_work_id),FOREIGN KEY(work_id) REFERENCES work_items(id) ON DELETE CASCADE,FOREIGN KEY(depends_on_work_id) REFERENCES work_items(id));
    CREATE INDEX IF NOT EXISTS work_dependencies_blocker ON work_dependencies(tenant_id,depends_on_work_id,status);
    CREATE TABLE IF NOT EXISTS work_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,work_id TEXT NOT NULL,matter_id TEXT,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(work_id) REFERENCES work_items(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS work_events_work ON work_events(tenant_id,work_id,seq);
    CREATE TABLE IF NOT EXISTS workflow_definitions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workflow_key TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,definition_hash TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,workflow_key,version));
    CREATE INDEX IF NOT EXISTS workflow_definitions_lookup ON workflow_definitions(tenant_id,workflow_key,version);
    CREATE TABLE IF NOT EXISTS workflow_instances(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workflow_key TEXT NOT NULL,workflow_version INTEGER NOT NULL,matter_id TEXT,state TEXT NOT NULL,current_step_id TEXT,version INTEGER NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS workflow_instances_tenant ON workflow_instances(tenant_id,state,workflow_key);
    CREATE TABLE IF NOT EXISTS workflow_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,instance_id TEXT NOT NULL,matter_id TEXT,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS workflow_events_instance ON workflow_events(tenant_id,instance_id,seq);
    CREATE TABLE IF NOT EXISTS feature_flags(tenant_id TEXT NOT NULL,flag_key TEXT NOT NULL,enabled INTEGER NOT NULL,rollout_percent INTEGER NOT NULL,version INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(tenant_id,flag_key));
    CREATE TABLE IF NOT EXISTS notification_intents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,channel TEXT NOT NULL,template_id TEXT NOT NULL,recipient_kind TEXT NOT NULL,recipient_id TEXT NOT NULL,object_type TEXT NOT NULL,object_id TEXT NOT NULL,dedupe_key TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,dedupe_key));
    CREATE INDEX IF NOT EXISTS notification_queue ON notification_intents(tenant_id,status,channel,created_at);
    CREATE TABLE IF NOT EXISTS notification_delivery_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,notification_id TEXT NOT NULL,event_type TEXT NOT NULL,channel TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(notification_id) REFERENCES notification_intents(id));
    CREATE INDEX IF NOT EXISTS notification_delivery_events_notification ON notification_delivery_events(tenant_id,notification_id,seq);
    CREATE TABLE IF NOT EXISTS to_studies(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,study_key TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,study_key),UNIQUE(tenant_id,id));
    CREATE INDEX IF NOT EXISTS to_studies_tenant ON to_studies(tenant_id,status,study_key);
    CREATE TABLE IF NOT EXISTS to_observations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,study_id TEXT NOT NULL,task_family TEXT NOT NULL,role_code TEXT NOT NULL,source_type TEXT NOT NULL,timing_basis TEXT NOT NULL,supersedes_observation_id TEXT,observed_at TEXT NOT NULL,recorded_at TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,study_id) REFERENCES to_studies(tenant_id,id),FOREIGN KEY(tenant_id,supersedes_observation_id) REFERENCES to_observations(tenant_id,id),UNIQUE(tenant_id,supersedes_observation_id));
    CREATE INDEX IF NOT EXISTS to_observations_study ON to_observations(tenant_id,study_id,task_family,role_code,recorded_at);
    CREATE TABLE IF NOT EXISTS to_estimates(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,study_id TEXT NOT NULL,task_family TEXT NOT NULL,metric TEXT NOT NULL,evidence_type TEXT NOT NULL,confidence TEXT NOT NULL,recorded_at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(tenant_id,study_id) REFERENCES to_studies(tenant_id,id));
    CREATE INDEX IF NOT EXISTS to_estimates_study ON to_estimates(tenant_id,study_id,task_family,metric,recorded_at);
    CREATE TABLE IF NOT EXISTS work_delegations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,principal_kind TEXT NOT NULL,principal_id TEXT NOT NULL,status TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,version INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,id));
    CREATE INDEX IF NOT EXISTS work_delegations_principal ON work_delegations(tenant_id,principal_kind,principal_id,status,starts_at,ends_at);
    CREATE TABLE IF NOT EXISTS delegation_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,delegation_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(tenant_id,delegation_id) REFERENCES work_delegations(tenant_id,id));
    CREATE INDEX IF NOT EXISTS delegation_events_rule ON delegation_events(tenant_id,delegation_id,seq);
    CREATE TABLE IF NOT EXISTS flow_snapshots(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,captured_at TEXT NOT NULL,trace_id TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS flow_snapshots_tenant ON flow_snapshots(tenant_id,seq);
    CREATE TABLE IF NOT EXISTS response_policies(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,policy_key TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,definition_hash TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,policy_key,version));
    CREATE INDEX IF NOT EXISTS response_policies_lookup ON response_policies(tenant_id,policy_key,version);
    CREATE TABLE IF NOT EXISTS escalation_intents(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,policy_key TEXT NOT NULL,policy_version INTEGER NOT NULL,source_work_id TEXT NOT NULL,matter_id TEXT,action TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,dedupe_key TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,dedupe_key));
    CREATE INDEX IF NOT EXISTS escalation_intents_queue ON escalation_intents(tenant_id,status,policy_key);
    CREATE TABLE IF NOT EXISTS escalation_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,intent_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL,FOREIGN KEY(intent_id) REFERENCES escalation_intents(id));
    CREATE INDEX IF NOT EXISTS escalation_events_intent ON escalation_events(tenant_id,intent_id,seq);

    CREATE TABLE IF NOT EXISTS org_groups(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,group_kind TEXT NOT NULL,group_ref TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,group_kind,group_ref),UNIQUE(tenant_id,id));
    CREATE INDEX IF NOT EXISTS org_groups_lookup ON org_groups(tenant_id,group_kind,group_ref,status);
    CREATE TABLE IF NOT EXISTS org_memberships(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,group_kind TEXT NOT NULL,group_ref TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT,version INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,group_kind,group_ref) REFERENCES org_groups(tenant_id,group_kind,group_ref));
    CREATE INDEX IF NOT EXISTS org_memberships_actor ON org_memberships(tenant_id,actor_id,status,starts_at,ends_at);
    CREATE INDEX IF NOT EXISTS org_memberships_group ON org_memberships(tenant_id,group_kind,group_ref,status,starts_at,ends_at);
    CREATE TABLE IF NOT EXISTS org_directory_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,trace_id TEXT NOT NULL,at TEXT NOT NULL,data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS org_directory_events_subject ON org_directory_events(tenant_id,subject_type,subject_id,seq);


    CREATE TRIGGER IF NOT EXISTS notification_delivery_events_append_only_update BEFORE UPDATE ON notification_delivery_events BEGIN SELECT RAISE(ABORT,'notification delivery events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS notification_delivery_events_append_only_delete BEFORE DELETE ON notification_delivery_events BEGIN SELECT RAISE(ABORT,'notification delivery events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audits_append_only_update BEFORE UPDATE ON audits BEGIN SELECT RAISE(ABORT,'audit ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audits_append_only_delete BEFORE DELETE ON audits BEGIN SELECT RAISE(ABORT,'audit ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_checkpoints_append_only_update BEFORE UPDATE ON audit_checkpoints BEGIN SELECT RAISE(ABORT,'audit checkpoints are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_checkpoints_append_only_delete BEFORE DELETE ON audit_checkpoints BEGIN SELECT RAISE(ABORT,'audit checkpoints are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS security_alerts_append_only_update BEFORE UPDATE ON security_alerts BEGIN SELECT RAISE(ABORT,'security alerts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS security_alerts_append_only_delete BEFORE DELETE ON security_alerts BEGIN SELECT RAISE(ABORT,'security alerts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_evidence_append_only_update BEFORE UPDATE ON recovery_evidence BEGIN SELECT RAISE(ABORT,'recovery evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_evidence_append_only_delete BEFORE DELETE ON recovery_evidence BEGIN SELECT RAISE(ABORT,'recovery evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS work_events_append_only_update BEFORE UPDATE ON work_events BEGIN SELECT RAISE(ABORT,'work events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS work_events_append_only_delete BEFORE DELETE ON work_events BEGIN SELECT RAISE(ABORT,'work events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS workflow_events_append_only_update BEFORE UPDATE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS workflow_events_append_only_delete BEFORE DELETE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS to_studies_locked_immutable BEFORE UPDATE ON to_studies WHEN OLD.status='LOCKED' OR NEW.tenant_id<>OLD.tenant_id OR NEW.study_key<>OLD.study_key OR NEW.id<>OLD.id OR NEW.version<>OLD.version+1 OR NOT (OLD.status='OPEN' AND NEW.status='LOCKED') BEGIN SELECT RAISE(ABORT,'TO study transition invalid'); END;
    CREATE TRIGGER IF NOT EXISTS to_observations_append_only_update BEFORE UPDATE ON to_observations BEGIN SELECT RAISE(ABORT,'TO observations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS to_observations_append_only_delete BEFORE DELETE ON to_observations BEGIN SELECT RAISE(ABORT,'TO observations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS to_estimates_append_only_update BEFORE UPDATE ON to_estimates BEGIN SELECT RAISE(ABORT,'TO estimates are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS to_estimates_append_only_delete BEFORE DELETE ON to_estimates BEGIN SELECT RAISE(ABORT,'TO estimates are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delegation_events_append_only_update BEFORE UPDATE ON delegation_events BEGIN SELECT RAISE(ABORT,'delegation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delegation_events_append_only_delete BEFORE DELETE ON delegation_events BEGIN SELECT RAISE(ABORT,'delegation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS flow_snapshots_append_only_update BEFORE UPDATE ON flow_snapshots BEGIN SELECT RAISE(ABORT,'flow snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS flow_snapshots_append_only_delete BEFORE DELETE ON flow_snapshots BEGIN SELECT RAISE(ABORT,'flow snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS response_policy_transition_guard BEFORE UPDATE ON response_policies WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.policy_key<>OLD.policy_key OR NEW.version<>OLD.version OR NEW.definition_hash<>OLD.definition_hash OR NOT ((OLD.status='DRAFT' AND NEW.status='PUBLISHED') OR (OLD.status='PUBLISHED' AND NEW.status='RETIRED')) BEGIN SELECT RAISE(ABORT,'response policy transition invalid'); END;
    CREATE TRIGGER IF NOT EXISTS escalation_events_append_only_update BEFORE UPDATE ON escalation_events BEGIN SELECT RAISE(ABORT,'escalation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS escalation_events_append_only_delete BEFORE DELETE ON escalation_events BEGIN SELECT RAISE(ABORT,'escalation events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS org_directory_events_append_only_update BEFORE UPDATE ON org_directory_events BEGIN SELECT RAISE(ABORT,'organisation directory events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS org_directory_events_append_only_delete BEFORE DELETE ON org_directory_events BEGIN SELECT RAISE(ABORT,'organisation directory events are append-only'); END;
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
  updateReviewEvent(next,original) {
    if(next.id!==original.id||next.tenantId!==original.tenantId||next.traceId!==original.traceId)return false;
    return Number(this.db.prepare('UPDATE inbound_events SET status=?,data_json=? WHERE id=? AND tenant_id=? AND status=? AND trace_id=? AND json(data_json)=json(?)')
      .run(next.status,json(next),original.id,original.tenantId,original.status,original.traceId,json(original)).changes)===1;
  }
  updateReviewException(next,original) {
    if(next.id!==original.id||next.tenantId!==original.tenantId||next.eventId!==original.eventId)return false;
    return Number(this.db.prepare('UPDATE exceptions SET status=?,data_json=? WHERE id=? AND tenant_id=? AND status=? AND event_id=? AND json(data_json)=json(?)')
      .run(next.status,json(next),original.id,original.tenantId,original.status,original.eventId,json(original)).changes)===1;
  }
  getException(t,id){const r=this.db.prepare('SELECT data_json FROM exceptions WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  listExceptions(t,status,limit=100){const n=Math.max(1,Math.min(Number(limit)||100,200));const q=status?'SELECT data_json FROM exceptions WHERE tenant_id=? AND status=? ORDER BY rowid LIMIT ?':'SELECT data_json FROM exceptions WHERE tenant_id=? ORDER BY rowid LIMIT ?';const rs=status?this.db.prepare(q).all(t,status,n):this.db.prepare(q).all(t,n);return rs.map(r=>parse(r.data_json));}
  enqueue({tenantId,type,payload,traceId,availableAt=new Date().toISOString()}){const id=this.uid('job'),now=new Date().toISOString();this.db.prepare("INSERT INTO jobs(id,tenant_id,type,status,attempts,available_at,payload_json,trace_id,created_at,updated_at) VALUES(?,?,?,'QUEUED',0,?,?,?,?,?)").run(id,tenantId,type,availableAt,json(payload),traceId,now,now);return this.getJob(id);}
  getJob(id){const statement=this.db.prepare('SELECT * FROM jobs WHERE id=?');statement.setReadBigInts(true);const r=statement.get(id);return r?{id:r.id,tenantId:r.tenant_id,type:r.type,status:r.status,attempts:readJobAttempts(r.attempts),availableAt:r.available_at,payload:parse(r.payload_json),lastError:r.last_error,traceId:r.trace_id,updatedAt:r.updated_at,createdAt:r.created_at}:null;}
  listEventJobs(tenantId,eventId,type='PROCESS_INBOUND') {
    return this.db.prepare("SELECT id FROM jobs WHERE tenant_id=? AND type=? AND json_extract(payload_json,'$.eventId')=? ORDER BY rowid DESC")
      .all(tenantId,type,eventId).map(row=>this.getJob(row.id));
  }
  cancelInboundJob(tenantId,jobId,{expected}={}) {
    if(!expected||expected.id!==jobId||expected.tenantId!==tenantId||expected.type!=='PROCESS_INBOUND'||expected.status!=='RUNNING')return 0;
    return Number(this.db.prepare("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=? AND tenant_id=? AND type='PROCESS_INBOUND' AND status='RUNNING' AND attempts=? AND trace_id=? AND updated_at=? AND available_at=? AND created_at=? AND json(payload_json)=json(?)")
      .run(new Date().toISOString(),jobId,tenantId,expected.attempts,expected.traceId,expected.updatedAt,expected.availableAt,expected.createdAt,json(expected.payload)).changes);
  }
  updateRecoveryEvent(next,original){return this.updateReviewEvent(next,original);}

  claimNext(type = null, tenantId = null, {eventId = null} = {}) {
    const now = new Date().toISOString();
    let query = "SELECT id FROM jobs WHERE status='QUEUED' AND available_at<=?";
    const args = [now];
    if(type==='PROCESS_INBOUND'){query+=" AND typeof(attempts)='integer' AND attempts>=0 AND attempts<? AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND strftime('%Y-%m-%dT%H:%M:%fZ',available_at)=available_at";args.push(Number.MAX_SAFE_INTEGER);}
    if (type !== null) { query += ' AND type=?'; args.push(type); }
    if (tenantId !== null) { query += ' AND tenant_id=?'; args.push(tenantId); }
    if (eventId !== null) { query += " AND json_extract(payload_json,'$.eventId')=?"; args.push(eventId); }
    const row = this.db.prepare(query + ' ORDER BY created_at, rowid LIMIT 1').get(...args);
    if (!row) return null;
    const claimed = this.db.prepare("UPDATE jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND status='QUEUED'").run(now, row.id);
    return Number(claimed.changes) === 1 ? this.getJob(row.id) : null;
  }
  claimJobById(id,type,tenantId,{eventId=null}={}) {
    const now=new Date().toISOString();
    let query="UPDATE jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND type=? AND tenant_id=? AND status='QUEUED' AND available_at<=?",args=[now,id,type,tenantId,now];
    if(eventId!==null){query+=" AND json_extract(payload_json,'$.eventId')=?";args.push(eventId);}
    const claimed=this.db.prepare(query).run(...args);
    return Number(claimed.changes)===1?this.getJob(id):null;
  }
  makeWritebackJobReadOnly(tenantId, jobId) {
    const job = this.getJob(jobId);
    if (!job || job.tenantId !== tenantId || job.type !== 'PROCLAIM_WRITEBACK') throw new Error('writeback job unavailable');
    const payload = {...job.payload, reconcileOnly: true};
    this.db.prepare("UPDATE jobs SET payload_json=? WHERE id=? AND tenant_id=? AND type='PROCLAIM_WRITEBACK' AND status IN ('QUEUED','RUNNING')").run(json(payload), jobId, tenantId);
  }
  isCurrentClaim(job) {
    return Boolean(this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND tenant_id=? AND type=? AND status='RUNNING' AND attempts=?")
      .get(job.id,job.tenantId,job.type,job.attempts));
  }
  completeClaimedJob(job) {
    return Number(this.db.prepare("UPDATE jobs SET status='DONE',updated_at=? WHERE id=? AND tenant_id=? AND type=? AND status='RUNNING' AND attempts=?")
      .run(new Date().toISOString(),job.id,job.tenantId,job.type,job.attempts).changes)===1;
  }
  failClaimedJob(job,error,{retry=true,delayMs=0}={}) {
    return Number(this.db.prepare("UPDATE jobs SET status=?,available_at=?,last_error=?,updated_at=? WHERE id=? AND tenant_id=? AND type=? AND status='RUNNING' AND attempts=?")
      .run(retry?'QUEUED':'DEAD',new Date(Date.now()+delayMs).toISOString(),String(error),new Date().toISOString(),job.id,job.tenantId,job.type,job.attempts).changes)===1;
  }
  requeueDeadJob(tenantId,jobId,{expected,availableAt=new Date().toISOString()}={}) {
    if(!expected||expected.id!==jobId||expected.tenantId!==tenantId||expected.status!=='DEAD')return false;
    const changed=this.db.prepare("UPDATE jobs SET status='QUEUED',available_at=?,updated_at=? WHERE id=? AND tenant_id=? AND type=? AND status='DEAD' AND attempts=? AND trace_id=? AND updated_at=? AND available_at=? AND created_at=? AND json(payload_json)=json(?) AND COALESCE(last_error,'')=COALESCE(?,'')")
      .run(availableAt,new Date().toISOString(),jobId,tenantId,expected.type,expected.attempts,expected.traceId,expected.updatedAt,expected.availableAt,expected.createdAt,json(expected.payload),expected.lastError).changes;
    return Number(changed)===1;
  }
  completeJob(id){this.db.prepare("UPDATE jobs SET status='DONE',updated_at=? WHERE id=?").run(new Date().toISOString(),id);return this.getJob(id);}
  failJob(id,error,{retry=true,delayMs=0}={}){const state=retry?'QUEUED':'DEAD';this.db.prepare('UPDATE jobs SET status=?,available_at=?,last_error=?,updated_at=? WHERE id=?').run(state,new Date(Date.now()+delayMs).toISOString(),String(error),new Date().toISOString(),id);return this.getJob(id);}
  getIdempotent(scope){const r=this.db.prepare('SELECT data_json FROM idempotency WHERE scope=?').get(scope);return parse(r?.data_json);}
  setIdempotent(scope,value){this.db.prepare('INSERT OR REPLACE INTO idempotency(scope,data_json) VALUES(?,?)').run(scope,json(value));}
  audit({tenantId,traceId,...entry}){
    const previous=this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq DESC LIMIT 1').get(tenantId);
    const previousItem=parse(previous?.data_json),previousHash=previousItem?.entryHash??'0'.repeat(64);
    const base={id:this.uid('aud'),at:new Date().toISOString(),tenantId,traceId,...entry};
    const item={...base,previousHash,entryHash:auditEntryHash(previousHash,base)};
    this.db.prepare('INSERT INTO audits(id,tenant_id,at,trace_id,data_json) VALUES(?,?,?,?,?)').run(item.id,tenantId,item.at,traceId,json(item));this.securityMonitor?.observeAudit(item);return item;
  }
  listAudits(t,limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));return this.db.prepare('SELECT data_json FROM (SELECT seq,data_json FROM audits WHERE tenant_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(t,n).map(r=>parse(r.data_json));}
  verifyAuditChain(t){const items=this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq').all(t).map(r=>parse(r.data_json));return verifyAuditChainEntries(items);}
  auditHead(t){const row=this.db.prepare('SELECT COUNT(*) count FROM audits WHERE tenant_id=?').get(t),last=this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq DESC LIMIT 1').get(t),item=parse(last?.data_json);return {auditCount:Number(row?.count??0),headHash:item?.entryHash??'0'.repeat(64)};}
  auditHashAtPosition(t,position){if(!Number.isInteger(position)||position<1)return null;const row=this.db.prepare('SELECT data_json FROM audits WHERE tenant_id=? ORDER BY seq LIMIT 1 OFFSET ?').get(t,position-1),item=parse(row?.data_json);return item?.entryHash??null;}
  putAuditCheckpoint(item){this.db.prepare('INSERT INTO audit_checkpoints(id,tenant_id,audit_count,head_hash,checkpoint_hash,anchor_ref_hash,created_at,data_json) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.auditCount,item.headHash,item.checkpointHash,item.anchorRefHash??null,item.createdAt,json(item));return item;}
  getAuditCheckpoint(t,id){const row=this.db.prepare('SELECT data_json FROM audit_checkpoints WHERE tenant_id=? AND id=?').get(t,id);return parse(row?.data_json);}
  latestAuditCheckpoint(t){const row=this.db.prepare('SELECT data_json FROM audit_checkpoints WHERE tenant_id=? ORDER BY audit_count DESC,created_at DESC,rowid DESC LIMIT 1').get(t);return parse(row?.data_json);}
  securityAlert(input){const item={id:this.uid('sal'),at:new Date().toISOString(),...input};this.db.prepare('INSERT INTO security_alerts(id,tenant_id,at,trace_id,data_json) VALUES(?,?,?,?,?)').run(item.id,item.tenantId,item.at,item.traceId,json(item));return item;}
  listSecurityAlerts(t,limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));return this.db.prepare('SELECT data_json FROM (SELECT seq,data_json FROM security_alerts WHERE tenant_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(t,n).map(r=>parse(r.data_json));}
  putWork(item){this.db.prepare('INSERT INTO work_items(id,tenant_id,matter_id,status,type,owner_kind,owner_id,priority,due_at,version,data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.matterId??null,item.state,item.type,item.owner.kind,item.owner.id,item.priority,item.dueAt??null,item.version,json(item));return item;}
  getWork(t,id){const r=this.db.prepare('SELECT data_json FROM work_items WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  updateWork(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE work_items SET matter_id=?,status=?,type=?,owner_kind=?,owner_id=?,priority=?,due_at=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.matterId??null,next.state,next.type,next.owner.kind,next.owner.id,next.priority,next.dueAt??null,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  listWork({tenantId,owner=null,states=null,types=null,matterId=null,limit=50,offset=0}={}){let q='SELECT data_json FROM work_items WHERE tenant_id=?',args=[tenantId];if(owner){q+=' AND owner_kind=? AND owner_id=?';args.push(owner.kind,owner.id);}if(matterId!==null){q+=' AND matter_id=?';args.push(matterId);}if(Array.isArray(states)&&states.length){q+=` AND status IN (${states.map(()=>'?').join(',')})`;args.push(...states);}if(Array.isArray(types)&&types.length){q+=` AND type IN (${types.map(()=>'?').join(',')})`;args.push(...types);}q+=' ORDER BY priority DESC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, rowid ASC LIMIT ? OFFSET ?';args.push(Math.max(1,Math.min(Number(limit)||50,500)),Math.max(0,Math.min(Number(offset)||0,10000)));return this.db.prepare(q).all(...args).map(r=>parse(r.data_json));}
  putWorkEvent(event){this.db.prepare('INSERT INTO work_events(id,tenant_id,work_id,matter_id,event_type,actor_id,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.workId,event.matterId??null,event.eventType,event.actorId,event.traceId,event.at,json(event));return event;}
  listWorkEvents(t,workId,limit=200){const n=Math.max(1,Math.min(Number(limit)||200,500));return this.db.prepare('SELECT data_json FROM work_events WHERE tenant_id=? AND work_id=? ORDER BY seq LIMIT ?').all(t,workId,n).map(r=>parse(r.data_json));}
  addWorkDependency(dep){this.db.prepare('INSERT INTO work_dependencies(tenant_id,work_id,depends_on_work_id,status,created_at,resolved_at,data_json) VALUES(?,?,?,?,?,?,?)').run(dep.tenantId,dep.workId,dep.dependsOnWorkId,dep.status,dep.createdAt,dep.resolvedAt??null,json(dep));return dep;}
  getWorkDependencies(t,workId,{activeOnly=true}={}){const q=`SELECT data_json FROM work_dependencies WHERE tenant_id=? AND work_id=?${activeOnly?" AND status='ACTIVE'":''} ORDER BY created_at`;return this.db.prepare(q).all(t,workId).map(r=>parse(r.data_json));}
  findWorkDependents(t,dependsOnWorkId,{activeOnly=true}={}){const q=`SELECT data_json FROM work_dependencies WHERE tenant_id=? AND depends_on_work_id=?${activeOnly?" AND status='ACTIVE'":''} ORDER BY created_at`;return this.db.prepare(q).all(t,dependsOnWorkId).map(r=>parse(r.data_json));}
  resolveWorkDependency(t,workId,dependsOnWorkId,resolvedAt){const row=this.db.prepare("SELECT data_json FROM work_dependencies WHERE tenant_id=? AND work_id=? AND depends_on_work_id=? AND status='ACTIVE'").get(t,workId,dependsOnWorkId);if(!row)return false;const dep=parse(row.data_json),next={...dep,status:'RESOLVED',resolvedAt};return Number(this.db.prepare("UPDATE work_dependencies SET status='RESOLVED',resolved_at=?,data_json=? WHERE tenant_id=? AND work_id=? AND depends_on_work_id=? AND status='ACTIVE'").run(resolvedAt,json(next),t,workId,dependsOnWorkId).changes)===1;}
  putResponsePolicy(item){this.db.prepare('INSERT INTO response_policies(id,tenant_id,policy_key,version,status,definition_hash,data_json) VALUES(?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.policyKey,item.version,item.status,item.definitionHash,json(item));return item;}
  getResponsePolicy(t,key,version){const r=this.db.prepare('SELECT data_json FROM response_policies WHERE tenant_id=? AND policy_key=? AND version=?').get(t,key,version);return parse(r?.data_json);}
  listResponsePolicies(t,key){return this.db.prepare('SELECT data_json FROM response_policies WHERE tenant_id=? AND policy_key=? ORDER BY version').all(t,key).map(r=>parse(r.data_json));}
  latestPublishedResponsePolicy(t,key){const r=this.db.prepare("SELECT data_json FROM response_policies WHERE tenant_id=? AND policy_key=? AND status='PUBLISHED' ORDER BY version DESC LIMIT 1").get(t,key);return parse(r?.data_json);}
  listPublishedResponsePolicies(t){return this.db.prepare("SELECT data_json FROM response_policies WHERE tenant_id=? AND status='PUBLISHED' ORDER BY policy_key,version DESC").all(t).map(r=>parse(r.data_json));}
  updateResponsePolicy(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.policyKey!==original.policyKey||next.version!==original.version||next.definitionHash!==original.definitionHash)return false;return Number(this.db.prepare('UPDATE response_policies SET status=?,data_json=? WHERE id=? AND tenant_id=? AND policy_key=? AND version=? AND status=? AND definition_hash=? AND json(data_json)=json(?)').run(next.status,json(next),original.id,original.tenantId,original.policyKey,original.version,original.status,original.definitionHash,json(original)).changes)===1;}
  putEscalationIntent(item){this.db.prepare('INSERT INTO escalation_intents(id,tenant_id,policy_key,policy_version,source_work_id,matter_id,action,status,version,dedupe_key,data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.policyKey,item.policyVersion,item.sourceWorkId,item.matterId??null,item.action,item.status,item.version,item.dedupeKey,json(item));return item;}
  getEscalationIntent(t,id){const r=this.db.prepare('SELECT data_json FROM escalation_intents WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  getEscalationByDedupe(t,key){const r=this.db.prepare('SELECT data_json FROM escalation_intents WHERE tenant_id=? AND dedupe_key=?').get(t,key);return parse(r?.data_json);}
  updateEscalationIntent(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.sourceWorkId!==original.sourceWorkId||next.policyKey!==original.policyKey||next.policyVersion!==original.policyVersion||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE escalation_intents SET status=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND status=? AND json(data_json)=json(?)').run(next.status,next.version,json(next),original.id,original.tenantId,original.version,original.status,json(original)).changes)===1;}
  listEscalationIntents(t,{status=null,limit=200}={}){const n=Math.max(1,Math.min(Number(limit)||200,500));const q=status?'SELECT data_json FROM escalation_intents WHERE tenant_id=? AND status=? ORDER BY rowid LIMIT ?':'SELECT data_json FROM escalation_intents WHERE tenant_id=? ORDER BY rowid LIMIT ?';const rows=status?this.db.prepare(q).all(t,status,n):this.db.prepare(q).all(t,n);return rows.map(r=>parse(r.data_json));}
  putEscalationEvent(event){this.db.prepare('INSERT INTO escalation_events(id,tenant_id,intent_id,event_type,actor_id,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.intentId,event.eventType,event.actorId,event.traceId,event.at,json(event));return event;}
  listEscalationEvents(t,intentId,limit=200){const n=Math.max(1,Math.min(Number(limit)||200,500));return this.db.prepare('SELECT data_json FROM escalation_events WHERE tenant_id=? AND intent_id=? ORDER BY seq LIMIT ?').all(t,intentId,n).map(r=>parse(r.data_json));}
  putOrgGroup(item){this.db.prepare('INSERT INTO org_groups(id,tenant_id,group_kind,group_ref,status,version,data_json) VALUES(?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.kind,item.groupRef,item.status,item.version,json(item));return item;}
  getOrgGroup(t,kind,groupRef){const r=this.db.prepare('SELECT data_json FROM org_groups WHERE tenant_id=? AND group_kind=? AND group_ref=?').get(t,kind,groupRef);return parse(r?.data_json);}
  getOrgGroupById(t,id){const r=this.db.prepare('SELECT data_json FROM org_groups WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  updateOrgGroup(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.kind!==original.kind||next.groupRef!==original.groupRef||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE org_groups SET status=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.status,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  listOrgGroups(t,{kind=null,status=null}={}){let q='SELECT data_json FROM org_groups WHERE tenant_id=?',args=[t];if(kind){q+=' AND group_kind=?';args.push(kind);}if(status){q+=' AND status=?';args.push(status);}q+=' ORDER BY rowid';return this.db.prepare(q).all(...args).map(r=>parse(r.data_json));}
  putOrgMembership(item){this.db.prepare('INSERT INTO org_memberships(id,tenant_id,group_kind,group_ref,actor_id,status,starts_at,ends_at,version,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.group.kind,item.group.id,item.memberActorId,item.status,item.startsAt,item.endsAt??null,item.version,json(item));return item;}
  getOrgMembership(t,id){const r=this.db.prepare('SELECT data_json FROM org_memberships WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  updateOrgMembership(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.memberActorId!==original.memberActorId||next.group.kind!==original.group.kind||next.group.id!==original.group.id||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE org_memberships SET status=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.status,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  listOrgMemberships(t,{actorId=null,group=null,status=null}={}){let q='SELECT data_json FROM org_memberships WHERE tenant_id=?',args=[t];if(actorId){q+=' AND actor_id=?';args.push(actorId);}if(group){q+=' AND group_kind=? AND group_ref=?';args.push(group.kind,group.id);}if(status){q+=' AND status=?';args.push(status);}q+=' ORDER BY rowid';return this.db.prepare(q).all(...args).map(r=>parse(r.data_json));}
  putOrgDirectoryEvent(event){this.db.prepare('INSERT INTO org_directory_events(id,tenant_id,subject_type,subject_id,event_type,actor_id,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.subjectType,event.subjectId,event.eventType,event.actorId,event.traceId,event.at,json(event));return event;}
  listOrgDirectoryEvents(t,{subjectType=null,subjectId=null,limit=500}={}){const n=Math.max(1,Math.min(Number(limit)||500,1000));let q='SELECT data_json FROM org_directory_events WHERE tenant_id=?',args=[t];if(subjectType){q+=' AND subject_type=?';args.push(subjectType);}if(subjectId){q+=' AND subject_id=?';args.push(subjectId);}q+=' ORDER BY seq LIMIT ?';args.push(n);return this.db.prepare(q).all(...args).map(r=>parse(r.data_json));}
  putWorkDelegation(item){this.db.prepare('INSERT INTO work_delegations(id,tenant_id,principal_kind,principal_id,status,starts_at,ends_at,version,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.principal.kind,item.principal.id,item.status,item.startsAt,item.endsAt,item.version,json(item));return item;}
  getWorkDelegation(t,id){const r=this.db.prepare('SELECT data_json FROM work_delegations WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  updateWorkDelegation(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.principal.kind!==original.principal.kind||next.principal.id!==original.principal.id||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE work_delegations SET status=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.status,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  listWorkDelegations(t,{principal=null,status=null}={}){let q='SELECT data_json FROM work_delegations WHERE tenant_id=?',args=[t];if(principal){q+=' AND principal_kind=? AND principal_id=?';args.push(principal.kind,principal.id);}if(status){q+=' AND status=?';args.push(status);}q+=' ORDER BY rowid';return this.db.prepare(q).all(...args).map(r=>parse(r.data_json));}
  putDelegationEvent(event){this.db.prepare('INSERT INTO delegation_events(id,tenant_id,delegation_id,event_type,actor_id,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.delegationId,event.eventType,event.actorId,event.traceId,event.at,json(event));return event;}
  listDelegationEvents(t,delegationId,limit=200){const n=Math.max(1,Math.min(Number(limit)||200,500));return this.db.prepare('SELECT data_json FROM delegation_events WHERE tenant_id=? AND delegation_id=? ORDER BY seq LIMIT ?').all(t,delegationId,n).map(r=>parse(r.data_json));}
  countWork(t){return Number(this.db.prepare('SELECT COUNT(*) c FROM work_items WHERE tenant_id=?').get(t).c);}
  listAllWorkDependencies(t,{activeOnly=true}={}){const q=`SELECT data_json FROM work_dependencies WHERE tenant_id=?${activeOnly?" AND status='ACTIVE'":''} ORDER BY created_at`;return this.db.prepare(q).all(t).map(r=>parse(r.data_json));}
  putFlowSnapshot(item){this.db.prepare('INSERT INTO flow_snapshots(id,tenant_id,captured_at,trace_id,data_json) VALUES(?,?,?,?,?)').run(item.id,item.tenantId,item.capturedAt,item.traceId,json(item));return item;}
  getFlowSnapshot(t,id){const r=this.db.prepare('SELECT data_json FROM flow_snapshots WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  listFlowSnapshots(t,limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));return this.db.prepare('SELECT data_json FROM (SELECT seq,data_json FROM flow_snapshots WHERE tenant_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(t,n).map(r=>parse(r.data_json));}
  putTOStudy(item){this.db.prepare('INSERT INTO to_studies(id,tenant_id,study_key,status,version,created_at,data_json) VALUES(?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.studyKey,item.status,item.version,item.createdAt,json(item));return item;}
  getTOStudy(t,id){const r=this.db.prepare('SELECT data_json FROM to_studies WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  getTOStudyByKey(t,key){const r=this.db.prepare('SELECT data_json FROM to_studies WHERE tenant_id=? AND study_key=?').get(t,key);return parse(r?.data_json);}
  updateTOStudy(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.studyKey!==original.studyKey||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE to_studies SET status=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.status,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  putTOObservation(item){this.db.prepare('INSERT INTO to_observations(id,tenant_id,study_id,task_family,role_code,source_type,timing_basis,supersedes_observation_id,observed_at,recorded_at,data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.studyId,item.taskFamily,item.roleCode,item.sourceType,item.timingBasis,item.supersedesObservationId??null,item.observedAt,item.recordedAt,json(item));return item;}
  getTOObservation(t,id){const r=this.db.prepare('SELECT data_json FROM to_observations WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  getTOObservationSuperseding(t,id){const r=this.db.prepare('SELECT data_json FROM to_observations WHERE tenant_id=? AND supersedes_observation_id=?').get(t,id);return parse(r?.data_json);}
  listTOObservations(t,studyId,limit=5000){const n=Math.max(1,Math.min(Number(limit)||5000,10000));return this.db.prepare('SELECT data_json FROM to_observations WHERE tenant_id=? AND study_id=? ORDER BY recorded_at,rowid LIMIT ?').all(t,studyId,n).map(r=>parse(r.data_json));}
  putTOEstimate(item){this.db.prepare('INSERT INTO to_estimates(id,tenant_id,study_id,task_family,metric,evidence_type,confidence,recorded_at,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.studyId,item.taskFamily,item.metric,item.evidenceType,item.confidence,item.recordedAt,json(item));return item;}
  getTOEstimate(t,id){const r=this.db.prepare('SELECT data_json FROM to_estimates WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  listTOEstimates(t,studyId,limit=5000){const n=Math.max(1,Math.min(Number(limit)||5000,10000));return this.db.prepare('SELECT data_json FROM to_estimates WHERE tenant_id=? AND study_id=? ORDER BY recorded_at,rowid LIMIT ?').all(t,studyId,n).map(r=>parse(r.data_json));}
  putWorkflowDefinition(item){this.db.prepare('INSERT INTO workflow_definitions(id,tenant_id,workflow_key,version,status,definition_hash,data_json) VALUES(?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.workflowKey,item.version,item.status,item.definitionHash,json(item));return item;}
  getWorkflowDefinition(t,key,version){const r=this.db.prepare('SELECT data_json FROM workflow_definitions WHERE tenant_id=? AND workflow_key=? AND version=?').get(t,key,version);return parse(r?.data_json);}
  listWorkflowDefinitions(t,key){return this.db.prepare('SELECT data_json FROM workflow_definitions WHERE tenant_id=? AND workflow_key=? ORDER BY version').all(t,key).map(r=>parse(r.data_json));}
  latestPublishedWorkflowDefinition(t,key){const r=this.db.prepare("SELECT data_json FROM workflow_definitions WHERE tenant_id=? AND workflow_key=? AND status='PUBLISHED' ORDER BY version DESC LIMIT 1").get(t,key);return parse(r?.data_json);}
  updateWorkflowDefinition(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.workflowKey!==original.workflowKey||next.version!==original.version)return false;return Number(this.db.prepare('UPDATE workflow_definitions SET status=?,definition_hash=?,data_json=? WHERE id=? AND tenant_id=? AND workflow_key=? AND version=? AND status=? AND definition_hash=? AND json(data_json)=json(?)').run(next.status,next.definitionHash,json(next),original.id,original.tenantId,original.workflowKey,original.version,original.status,original.definitionHash,json(original)).changes)===1;}
  putWorkflowInstance(item){this.db.prepare('INSERT INTO workflow_instances(id,tenant_id,workflow_key,workflow_version,matter_id,state,current_step_id,version,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.workflowKey,item.workflowVersion,item.matterId??null,item.state,item.currentStepId,item.version,json(item));return item;}
  getWorkflowInstance(t,id){const r=this.db.prepare('SELECT data_json FROM workflow_instances WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  updateWorkflowInstance(next,original){if(next.id!==original.id||next.tenantId!==original.tenantId||next.version!==original.version+1)return false;return Number(this.db.prepare('UPDATE workflow_instances SET state=?,current_step_id=?,version=?,data_json=? WHERE id=? AND tenant_id=? AND version=? AND json(data_json)=json(?)').run(next.state,next.currentStepId??null,next.version,json(next),original.id,original.tenantId,original.version,json(original)).changes)===1;}
  putWorkflowEvent(event){this.db.prepare('INSERT INTO workflow_events(id,tenant_id,instance_id,matter_id,event_type,actor_id,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.instanceId,event.matterId??null,event.eventType,event.actorId,event.traceId,event.at,json(event));return event;}
  listWorkflowEvents(t,instanceId,limit=200){const n=Math.max(1,Math.min(Number(limit)||200,500));return this.db.prepare('SELECT data_json FROM workflow_events WHERE tenant_id=? AND instance_id=? ORDER BY seq LIMIT ?').all(t,instanceId,n).map(r=>parse(r.data_json));}
  getFeatureFlag(t,key){const r=this.db.prepare('SELECT data_json FROM feature_flags WHERE tenant_id=? AND flag_key=?').get(t,key);return parse(r?.data_json);}
  putFeatureFlag(next,current=null){if(!current){this.db.prepare('INSERT INTO feature_flags(tenant_id,flag_key,enabled,rollout_percent,version,data_json) VALUES(?,?,?,?,?,?)').run(next.tenantId,next.key,next.enabled?1:0,next.rolloutPercent,next.version,json(next));return next;}if(next.version!==current.version+1)throw new Error('feature flag version invalid');const changed=Number(this.db.prepare('UPDATE feature_flags SET enabled=?,rollout_percent=?,version=?,data_json=? WHERE tenant_id=? AND flag_key=? AND version=? AND json(data_json)=json(?)').run(next.enabled?1:0,next.rolloutPercent,next.version,json(next),current.tenantId,current.key,current.version,json(current)).changes);if(changed!==1)throw new Error('feature flag version conflict');return next;}
  putNotificationIntent(item){this.db.prepare('INSERT INTO notification_intents(id,tenant_id,channel,template_id,recipient_kind,recipient_id,object_type,object_id,dedupe_key,status,attempts,expires_at,created_at,updated_at,data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.tenantId,item.channel,item.templateId,item.recipient.kind,item.recipient.id,item.objectType,item.objectId,item.dedupeKey,item.status,item.attempts,item.expiresAt??null,item.createdAt,item.updatedAt,json(item));return item;}
  getNotificationByDedupe(t,key){const r=this.db.prepare('SELECT data_json FROM notification_intents WHERE tenant_id=? AND dedupe_key=?').get(t,key);return parse(r?.data_json);}
  getNotificationIntent(t,id){const r=this.db.prepare('SELECT data_json FROM notification_intents WHERE tenant_id=? AND id=?').get(t,id);return parse(r?.data_json);}
  claimNotificationIntent(t,channel=null,now=new Date().toISOString()){let q="SELECT id FROM notification_intents WHERE tenant_id=? AND status='QUEUED' AND (expires_at IS NULL OR expires_at>?)",args=[t,now];if(channel){q+=' AND channel=?';args.push(channel);}const row=this.db.prepare(q+' ORDER BY created_at,rowid LIMIT 1').get(...args);if(!row)return null;const current=this.getNotificationIntent(t,row.id),next={...current,status:'SENDING',attempts:current.attempts+1,updatedAt:now};return this.updateNotificationIntent(next,current)?next:null;}
  claimNotificationIntentById(t,id,channel=null,now=new Date().toISOString()){const current=this.getNotificationIntent(t,id);if(!current||current.status!=='QUEUED'||current.expiresAt&&current.expiresAt<=now||channel!==null&&current.channel!==channel)return null;const next={...current,status:'SENDING',attempts:current.attempts+1,updatedAt:now};return this.updateNotificationIntent(next,current)?next:null;}
  updateNotificationIntent(next,original){return Number(this.db.prepare('UPDATE notification_intents SET status=?,attempts=?,expires_at=?,updated_at=?,data_json=? WHERE id=? AND tenant_id=? AND status=? AND attempts=? AND json(data_json)=json(?)').run(next.status,next.attempts,next.expiresAt??null,next.updatedAt,json(next),original.id,original.tenantId,original.status,original.attempts,json(original)).changes)===1;}
  recoverExpiredNotificationIntents({tenantId,channel=null,leaseMs=300000,now=new Date().toISOString()}={}){if(typeof tenantId!=='string'||!tenantId||!Number.isFinite(leaseMs)||leaseMs<1000)throw new Error('invalid notification recovery');const before=new Date(Date.parse(now)-leaseMs).toISOString();let q="SELECT id FROM notification_intents WHERE tenant_id=? AND status='SENDING' AND updated_at<=?",args=[tenantId,before];if(channel){q+=' AND channel=?';args.push(channel);}let changed=0;for(const row of this.db.prepare(q).all(...args)){const current=this.getNotificationIntent(tenantId,row.id);if(!current||current.status!=='SENDING')continue;const next={...current,status:current.attempts<3?'QUEUED':'DEAD',lastError:'NOTIFICATION_LEASE_EXPIRED',updatedAt:now};if(this.updateNotificationIntent(next,current))changed++;}return changed;}
  expireNotificationIntents({tenantId,channel=null,now=new Date().toISOString()}={}){if(typeof tenantId!=='string'||!tenantId)throw new Error('invalid notification expiry');let q="SELECT id FROM notification_intents WHERE tenant_id=? AND status='QUEUED' AND expires_at IS NOT NULL AND expires_at<=?",args=[tenantId,now];if(channel){q+=' AND channel=?';args.push(channel);}let changed=0;for(const row of this.db.prepare(q).all(...args)){const current=this.getNotificationIntent(tenantId,row.id);if(!current||current.status!=='QUEUED')continue;const next={...current,status:'DEAD',lastError:'NOTIFICATION_EXPIRED',updatedAt:now};if(this.updateNotificationIntent(next,current))changed++;}return changed;}
  putNotificationDeliveryEvent(event){this.db.prepare('INSERT INTO notification_delivery_events(id,tenant_id,notification_id,event_type,channel,trace_id,at,data_json) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.tenantId,event.notificationId,event.eventType,event.channel,event.traceId,event.at,json(event));return event;}
  listNotificationDeliveryEvents(t,notificationId,limit=200){const n=Math.max(1,Math.min(Number(limit)||200,500));return this.db.prepare('SELECT data_json FROM notification_delivery_events WHERE tenant_id=? AND notification_id=? ORDER BY seq LIMIT ?').all(t,notificationId,n).map(r=>parse(r.data_json));}
  recoveryEvidence(input){const previous=this.db.prepare('SELECT data_json FROM recovery_evidence WHERE tenant_id=? ORDER BY seq DESC LIMIT 1').get(input.tenantId);const previousItem=parse(previous?.data_json),previousHash=previousItem?.entryHash??'0'.repeat(64);const base={id:this.uid('rec'),at:new Date().toISOString(),...input};const item={...base,previousHash,entryHash:auditEntryHash(previousHash,base)};this.db.prepare('INSERT INTO recovery_evidence(id,tenant_id,at,trace_id,data_json) VALUES(?,?,?,?,?)').run(item.id,item.tenantId,item.at,item.traceId,json(item));return item;}
  listRecoveryEvidence(t,limit=100){const n=Math.max(1,Math.min(Number(limit)||100,500));return this.db.prepare('SELECT data_json FROM (SELECT seq,data_json FROM recovery_evidence WHERE tenant_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(t,n).map(r=>parse(r.data_json));}
  recoveryBackupState(t,backupSetId,backupId){
    const rows=this.db.prepare("SELECT data_json FROM recovery_evidence WHERE tenant_id=? AND json_extract(data_json,'$.eventType')='BACKUP_VERIFIED' AND json_extract(data_json,'$.backupId')=? ORDER BY seq LIMIT 1").get(t,backupId);
    const high=this.db.prepare("SELECT MAX(CAST(json_extract(data_json,'$.generation') AS INTEGER)) AS generation FROM recovery_evidence WHERE tenant_id=? AND json_extract(data_json,'$.eventType')='BACKUP_VERIFIED' AND json_extract(data_json,'$.backupSetId')=?").get(t,backupSetId);
    return {existing:parse(rows?.data_json),highestGeneration:Number(high.generation??0)};
  }
  recoveryRestoreState(t,restoreId){return this.db.prepare("SELECT data_json FROM recovery_evidence WHERE tenant_id=? AND json_extract(data_json,'$.restoreId')=? ORDER BY seq").all(t,restoreId).map(r=>parse(r.data_json));}
  verifyRecoveryEvidenceChain(t){
    let previous='0'.repeat(64);
    try{for(const row of this.db.prepare('SELECT id,at,trace_id,data_json FROM recovery_evidence WHERE tenant_id=? ORDER BY seq').iterate(t)){
      const item=parse(row.data_json);if(!verifyAuditChainEntries([item],{genesis:previous})||item.tenantId!==t||item.id!==row.id||item.at!==row.at||item.traceId!==row.trace_id)return false;previous=item.entryHash;
    }return true;}catch{return false;}
  }
}
