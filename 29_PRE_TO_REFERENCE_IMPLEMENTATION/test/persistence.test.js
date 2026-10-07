import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQLiteStore } from '../src/sqliteStore.js';
import { FileObjectStorage } from '../src/fileObjectStorage.js';
import { createPersistentApp, seed } from '../src/persistentServer.js';

async function withServer(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legalops-db-'));const app=createPersistentApp({dbFile:path.join(dir,'db.sqlite')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const {port}=app.server.address();try{await fn(`http://127.0.0.1:${port}`,app,dir)}finally{await new Promise(r=>app.server.close(r));app.close();fs.rmSync(dir,{recursive:true,force:true})}}
const headers=(tenant,extra={})=>({'content-type':'application/json','x-tenant-id':tenant,...extra});

test('sqlite persists data and idempotency across restart',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legalops-store-'));const db=path.join(dir,'db.sqlite');let s=new SQLiteStore(db,seed);assert.equal(s.getMatter('tenant-a','m_a1').id,'m_a1');assert.equal(s.getMatter('tenant-b','m_a1'),null);s.setIdempotent('tenant-a:test:k',{eventId:'evt_persisted'});s.close();s=new SQLiteStore(db,seed);assert.equal(s.getMatter('tenant-a','m_a1').id,'m_a1');assert.equal(s.getIdempotent('tenant-a:test:k').eventId,'evt_persisted');s.close();fs.rmSync(dir,{recursive:true,force:true})});

test('durable job can be claimed and completed',()=>{const s=new SQLiteStore(':memory:',seed);const j=s.enqueue({tenantId:'tenant-a',type:'INGEST',payload:{x:1}});const c=s.claimNext();assert.equal(c.id,j.id);assert.equal(c.status,'RUNNING');const done=s.completeJob(c.id);assert.equal(done.status,'DONE');s.close()});

test('object storage is content-addressed and tenant scoped',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legalops-obj-'));const st=new FileObjectStorage(dir);const a=st.put({tenantId:'tenant-a',bytes:Buffer.from('hello'),contentType:'text/plain'});assert.equal(st.get({tenantId:'tenant-a',objectRef:a.objectRef}).toString(),'hello');assert.equal(st.get({tenantId:'tenant-b',objectRef:a.objectRef}),null);fs.rmSync(dir,{recursive:true,force:true})});

test('persistent API idempotency survives normal requests',()=>withServer(async base=>{const opt={method:'POST',headers:headers('tenant-a',{'idempotency-key':'persistent-1'}),body:JSON.stringify({subject:'CLM-70001',body:'update'})};const a=await(await fetch(base+'/api/v1/inbound-events',opt)).json();const b=await(await fetch(base+'/api/v1/inbound-events',opt)).json();assert.equal(a.eventId,b.eventId)}));

test('review UI is served',()=>withServer(async base=>{const r=await fetch(base+'/');assert.equal(r.status,200);const text=await r.text();assert.match(text,/Inbound Review Queue/)}));

test('job endpoint is tenant scoped',()=>withServer(async base=>{const r=await fetch(base+'/api/v1/jobs',{method:'POST',headers:headers('tenant-a'),body:JSON.stringify({type:'TEST',payload:{ok:true}})});assert.equal(r.status,202);const a=await(await fetch(base+'/api/v1/jobs',{headers:headers('tenant-a')})).json();const b=await(await fetch(base+'/api/v1/jobs',{headers:headers('tenant-b')})).json();assert.equal(a.items.length,1);assert.equal(b.items.length,0)}));
