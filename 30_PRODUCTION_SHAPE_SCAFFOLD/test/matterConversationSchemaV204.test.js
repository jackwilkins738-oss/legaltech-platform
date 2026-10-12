import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMigrationManifest,verifyMigrationDirectory} from '../src/migrationSafety.js';

const migrations=fileURLToPath(new URL('../db/migrations/',import.meta.url));
test('V204 SQL manifest pins a verified dormant conversation schema',()=>{
 const manifest=loadMigrationManifest(path.join(migrations,'MANIFEST.json'));
 verifyMigrationDirectory({directory:migrations,manifest});
 const entry=manifest.migrations.find(x=>x.file==='064_matter_conversations_default_deny.sql');
 assert.equal(entry?.destructive,false);
 const sql=fs.readFileSync(path.join(migrations,entry.file),'utf8');
 for(const name of ['matter_conversation_threads','matter_conversation_participants','matter_conversation_messages','matter_conversation_audit']){
  assert.match(sql,new RegExp('CREATE TABLE public\\.'+name+' \\('));
  assert.match(sql,new RegExp('ALTER TABLE public\\.'+name+' ENABLE ROW LEVEL SECURITY;'));
  assert.match(sql,new RegExp('ALTER TABLE public\\.'+name+' FORCE ROW LEVEL SECURITY;'));
  assert.doesNotMatch(sql,new RegExp('GRANT .*'+name,'i'));
  assert.doesNotMatch(sql,new RegExp('CREATE POLICY .*'+name,'i'));
 }
 assert.match(sql,/UNIQUE\(tenant_id,thread_id,author_actor_id,request_id\)/);
 assert.match(sql,/UNIQUE\(tenant_id,thread_id,revision\)/);
 assert.doesNotMatch(sql,/DROP TABLE|DISABLE ROW LEVEL SECURITY|TRUNCATE/i);
});
