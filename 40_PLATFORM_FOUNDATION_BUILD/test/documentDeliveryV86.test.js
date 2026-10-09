import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {DocumentDeliveryService,DOCUMENT_DELIVERY_LIMITS} from '../src/documentDelivery.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {SecurityInterlockRegistry} from '../src/securityInterlock.js';

function fx(t,{mode='INHERIT',zone=null}={}){
  let now=Date.parse('2026-10-09T12:00:00Z'),allowed=true,ref='doc-1';const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doc-delivery-')),storage=new LocalObjectStorage(dir),bytes=Buffer.from('synthetic legal document'),put=storage.put({tenantId:'tenant-a',bytes,contentType:'application/pdf',metadata:{filename:'synthetic.pdf'}});
  const matter={id:'matter-1',tenantId:'tenant-a',visibility:'STANDARD',securityZoneId:null};
  const doc=()=>({tenantId:'tenant-a',matterId:matter.id,documentRef:ref,mode,securityZoneId:zone});
  const resolveDocument=async({tenantId,documentRef})=>allowed&&tenantId==='tenant-a'&&documentRef===ref?{document:doc(),matter:{...matter},objectRef:put.objectRef,sha256:put.hash,size:put.size,contentType:put.contentType}:null;
  const service=new DocumentDeliveryService({resolveDocument,objectStorage:storage,now:()=>now});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const session=(over={})=>({tenantId:'tenant-a',actorId:'user-a',sessionId:'s1',capabilities:[],roles:[],securityZoneIds:[],matterMembershipIds:[],documentAccessRefs:[],breakGlassGrants:[],...over});
  return {service,storage,bytes,put,matter,session,get now(){return now},set now(v){now=v},deny(){allowed=false},replaceRef(v){ref=v}};
}
const issue=(x,over={})=>x.service.issueGrant({session:x.session(),documentRef:'doc-1',traceId:'trace-issue',ttlMs:60_000,...over});


test('V86 grant is actor-bound short-lived and contains no storage reference',async t=>{const x=fx(t),grant=await issue(x);assert.match(grant.token,/^[A-Za-z0-9_-]+$/);assert.equal(Object.hasOwn(grant,'objectRef'),false);assert.equal(DOCUMENT_DELIVERY_LIMITS.maxGrantMs,300000);await assert.rejects(()=>issue(x,{ttlMs:300001}),/DOCUMENT_DELIVERY_TTL_INVALID/);const events=JSON.stringify(x.service.listEvents('tenant-a'));assert.equal(events.includes(grant.token),false);assert.equal(events.includes(x.put.objectRef),false);});

test('V86 authorized grant streams bytes server-side without revealing raw object reference',async t=>{const x=fx(t),grant=await issue(x),out=await x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'trace-get'});assert.deepEqual(out.body,x.bytes);assert.equal(out.contentType,'application/pdf');assert.equal(out.sha256,x.put.hash);assert.equal(Object.hasOwn(out,'objectRef'),false);});

test('V86 grant is single-use and wrong actor or tenant gets generic invalid result',async t=>{const x=fx(t),grant=await issue(x);await assert.rejects(()=>x.service.consumeGrant({session:x.session({actorId:'user-b'}),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'x'}),/DOCUMENT_DELIVERY_GRANT_INVALID/);await x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'ok'});await assert.rejects(()=>x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'again'}),/DOCUMENT_DELIVERY_GRANT_INVALID/);await assert.rejects(()=>x.service.consumeGrant({session:x.session({tenantId:'tenant-b'}),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'other'}),/DOCUMENT_DELIVERY_GRANT_INVALID/);});

test('V86 expiry fails closed before storage resolution',async t=>{const x=fx(t),grant=await issue(x);x.now+=60_001;await assert.rejects(()=>x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'late'}),/DOCUMENT_DELIVERY_GRANT_INVALID/);});

test('V86 current document authorization is rechecked at redemption',async t=>{const x=fx(t,{mode:'RESTRICTED'}),grant=await issue(x,{session:x.session({documentAccessRefs:['doc-1']})});await assert.rejects(()=>x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'revoked'}),/DOCUMENT_DELIVERY_GRANT_INVALID/);});

test('V86 matter and security-zone authorization cannot be bypassed by a delivery grant',async t=>{const x=fx(t,{mode:'SECURITY_ZONE',zone:'zone-1'});await assert.rejects(()=>issue(x),/DOCUMENT_DELIVERY_UNAVAILABLE/);const grant=await issue(x,{session:x.session({securityZoneIds:['zone-1']})});assert.ok(grant.grantId);});

test('V86 restricted matter requires current membership before grant issue',async t=>{const x=fx(t);x.matter.visibility='PRIVATE';await assert.rejects(()=>issue(x),/DOCUMENT_DELIVERY_UNAVAILABLE/);const grant=await issue(x,{session:x.session({matterMembershipIds:['matter-1']})});assert.ok(grant.grantId);});

test('V86 resolver disappearance or document identity change invalidates an existing grant',async t=>{const x=fx(t),grant=await issue(x);x.deny();await assert.rejects(()=>x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'gone'}),/DOCUMENT_DELIVERY_UNAVAILABLE/);});

test('V86 object integrity is reverified by storage and delivery binding',async t=>{const x=fx(t),grant=await issue(x),hash=x.put.hash,file=path.join(x.storage.root,'tenant-a',hash+'.bin');fs.writeFileSync(file,Buffer.from('tampered'));await assert.rejects(()=>x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'tamper'}),/DOCUMENT_DELIVERY_UNAVAILABLE/);});

test('V86 browser cannot supply objectRef destination URL or storage identity',async t=>{const x=fx(t);await assert.rejects(()=>x.service.issueGrant({session:x.session(),documentRef:'doc-1',traceId:'x',ttlMs:60000,objectRef:x.put.objectRef}),/DOCUMENT_DELIVERY_REQUEST_INVALID/);await assert.rejects(()=>x.service.issueGrant({session:x.session(),documentRef:'doc-1',traceId:'x',ttlMs:60000,url:'https://example.invalid'}),/DOCUMENT_DELIVERY_REQUEST_INVALID/);});

test('V86 ALL_EGRESS interlock blocks document delivery',async t=>{const x=fx(t),interlock=new SecurityInterlockRegistry({authorizeChange:()=>true}),svc=new DocumentDeliveryService({resolveDocument:async({tenantId,documentRef})=>({document:{tenantId,matterId:'m1',documentRef,mode:'INHERIT'},matter:{id:'m1',tenantId,visibility:'STANDARD'},objectRef:x.put.objectRef,sha256:x.put.hash,size:x.put.size,contentType:'application/pdf'}),objectStorage:x.storage,securityInterlock:interlock});interlock.activate({tenantId:'tenant-a',control:'ALL_EGRESS',actorId:'sec-a',traceId:'i',incidentId:'inc-1',reasonCode:'CONTAIN'});await assert.rejects(()=>svc.issueGrant({session:x.session(),documentRef:'doc-1',traceId:'x',ttlMs:60000}),/SECURITY_INTERLOCK_ACTIVE/);});

test('V86 event evidence contains hashes and result metadata but never token or raw object ref',async t=>{const x=fx(t),grant=await issue(x);await x.service.consumeGrant({session:x.session(),grantId:grant.grantId,token:grant.token,documentRef:'doc-1',traceId:'done'});const text=JSON.stringify(x.service.listEvents('tenant-a'));assert.equal(text.includes(grant.token),false);assert.equal(text.includes(x.put.objectRef),false);assert.match(text,/documentRefHash/);assert.match(text,/DOCUMENT_DELIVERED/);});
