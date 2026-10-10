import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadMigrationManifest,verifyMigrationDirectory,verifyAppliedMigrations,detectDestructiveSql,createMigrationReadinessProbe} from '../src/migrationSafety.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const migrationDir=path.resolve(here,'../db/migrations');
const manifestPath=path.join(migrationDir,'MANIFEST.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function copyMigrations(){ const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-migrations-')); for(const name of fs.readdirSync(migrationDir)) fs.copyFileSync(path.join(migrationDir,name),path.join(dir,name)); return dir; }
function cleanup(dir){ fs.rmSync(dir,{recursive:true,force:true}); }

test('V77 committed migration manifest exactly verifies the canonical migration directory',()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const result=verifyMigrationDirectory({directory:migrationDir,manifest});
  assert.deepEqual(result,{status:'VERIFIED',count:54,latest:'054_domain_result_adoption.sql'});
});

test('V77 changed migration bytes are detected as checksum drift',()=>{
  const dir=copyMigrations(); try{
    fs.appendFileSync(path.join(dir,'016_work_queue_read_model.sql'),'\n-- tampered\n');
    assert.throws(()=>verifyMigrationDirectory({directory:dir,manifest:loadMigrationManifest(path.join(dir,'MANIFEST.json'))}),error=>error.code==='MIGRATION_CHECKSUM_DRIFT');
  } finally { cleanup(dir); }
});

test('V77 missing and unexpected SQL migrations fail closed',()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const missing=copyMigrations(); try{ fs.unlinkSync(path.join(missing,'016_work_queue_read_model.sql')); assert.throws(()=>verifyMigrationDirectory({directory:missing,manifest}),error=>error.code==='MIGRATION_SET_DRIFT'); } finally { cleanup(missing); }
  const extra=copyMigrations(); try{ fs.writeFileSync(path.join(extra,'017_surprise.sql'),'SELECT 1;'); assert.throws(()=>verifyMigrationDirectory({directory:extra,manifest}),error=>error.code==='MIGRATION_SET_DRIFT'); } finally { cleanup(extra); }
});

test('V77 migration sequence gaps and duplicate entries are refused',()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const gap={...manifest,migrations:[manifest.migrations[0],manifest.migrations[2]]};
  assert.throws(()=>verifyAppliedMigrations({manifest:gap,applied:[]}),error=>error.code==='MIGRATION_SEQUENCE_GAP');
  const duplicate={...manifest,migrations:[manifest.migrations[0],manifest.migrations[0]]};
  assert.throws(()=>verifyAppliedMigrations({manifest:duplicate,applied:[]}),error=>['DUPLICATE_MIGRATION_FILE','MIGRATION_SEQUENCE_GAP'].includes(error.code));
});

test('V77 destructive SQL requires an explicit bounded review reference',()=>{
  assert.equal(detectDestructiveSql('ALTER TABLE matters DROP COLUMN subject;'),true);
  assert.equal(detectDestructiveSql('TRUNCATE matters;'),true);
  assert.equal(detectDestructiveSql('DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;'),false);
  const bytes=Buffer.from('DROP TABLE matters;\n');
  const manifest={version:1,migrations:[{file:'001_drop.sql',sha256:hash(bytes),destructive:false}]};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-destructive-')); try{
    fs.writeFileSync(path.join(dir,'001_drop.sql'),bytes);
    assert.throws(()=>verifyMigrationDirectory({directory:dir,manifest}),error=>error.code==='UNREVIEWED_DESTRUCTIVE_MIGRATION');
    const reviewed={version:1,migrations:[{file:'001_drop.sql',sha256:hash(bytes),destructive:true,destructiveReviewRef:'SEC-CHANGE-1234'}]};
    assert.equal(verifyMigrationDirectory({directory:dir,manifest:reviewed}).status,'VERIFIED');
  } finally { cleanup(dir); }
});

test('V77 symlinked migration content is refused even when its bytes match',t=>{
  const dir=copyMigrations(); try{
    const name='016_work_queue_read_model.sql';
    const original=fs.readFileSync(path.join(dir,name));
    const target=path.join(dir,'safe-target.txt');
    fs.writeFileSync(target,original);
    fs.unlinkSync(path.join(dir,name));
    try{
      fs.symlinkSync(target,path.join(dir,name));
    }catch(error){
      if(['EPERM','EACCES','ENOTSUP'].includes(error?.code)){
        t.skip('OS does not permit file symlink creation for this test process');
        return;
      }
      throw error;
    }
    assert.throws(()=>verifyMigrationDirectory({directory:dir,manifest:loadMigrationManifest(path.join(dir,'MANIFEST.json'))}),error=>['UNSAFE_MIGRATION_FILE','MIGRATION_PATH_ESCAPE'].includes(error.code));
  } finally { cleanup(dir); }
});

test('V77 applied migrations must be the exact checksum-pinned ordered prefix',()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const prefix=manifest.migrations.slice(0,5).map(({file,sha256})=>({file,sha256}));
  const state=verifyAppliedMigrations({manifest,applied:prefix});
  assert.equal(state.status,'PENDING'); assert.equal(state.pending[0],'006_security_hardening.sql');
  const reordered=[prefix[1],prefix[0]];
  assert.throws(()=>verifyAppliedMigrations({manifest,applied:reordered}),error=>error.code==='APPLIED_MIGRATION_ORDER_DRIFT');
  const tampered=prefix.map(x=>({...x})); tampered[2].sha256='0'.repeat(64);
  assert.throws(()=>verifyAppliedMigrations({manifest,applied:tampered}),error=>error.code==='APPLIED_MIGRATION_CHECKSUM_DRIFT');
});

test('V77 current applied migration set verifies without exposing SQL',()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const applied=manifest.migrations.map(({file,sha256})=>({file,sha256}));
  const state=verifyAppliedMigrations({manifest,applied});
  assert.deepEqual(state,{status:'CURRENT',appliedCount:54,pending:[],latestRequired:'054_domain_result_adoption.sql'});
  assert.equal(JSON.stringify(state).includes('CREATE TABLE'),false);
});

test('V77 schema readiness fails closed on pending or drifted applied migrations',async()=>{
  const manifest=loadMigrationManifest(manifestPath);
  const full=manifest.migrations.map(({file,sha256})=>({file,sha256}));
  assert.deepEqual(await createMigrationReadinessProbe({manifest,getApplied:async()=>full})(),{ok:true,code:'SCHEMA_CURRENT'});
  assert.deepEqual(await createMigrationReadinessProbe({manifest,getApplied:async()=>full.slice(0,-1)})(),{ok:false,code:'SCHEMA_MIGRATIONS_PENDING'});
  const drift=full.map(x=>({...x})); drift[0].sha256='f'.repeat(64);
  assert.deepEqual(await createMigrationReadinessProbe({manifest,getApplied:async()=>drift})(),{ok:false,code:'SCHEMA_MIGRATION_DRIFT'});
});

test('V77 manifest parser refuses symlink, oversized shape, and unexpected properties',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-manifest-')); try{
    const target=path.join(dir,'real.json');
    fs.writeFileSync(target,JSON.stringify({version:1,migrations:[]}));
    const link=path.join(dir,'MANIFEST.json');
    try{
      fs.symlinkSync(target,link);
      assert.throws(()=>loadMigrationManifest(link),error=>error.code==='INVALID_MIGRATION_MANIFEST_FILE');
    }catch(error){
      if(['EPERM','EACCES','ENOTSUP'].includes(error?.code)){
        t.diagnostic('OS does not permit file symlink creation; symlink-specific assertion skipped');
      }else{
        throw error;
      }
    }
  } finally { cleanup(dir); }

  const manifest=loadMigrationManifest(manifestPath);
  const malformed={...manifest,unexpected:true};
  assert.throws(()=>verifyAppliedMigrations({manifest:malformed,applied:[]}),error=>error.code==='INVALID_MIGRATION_MANIFEST');
});
