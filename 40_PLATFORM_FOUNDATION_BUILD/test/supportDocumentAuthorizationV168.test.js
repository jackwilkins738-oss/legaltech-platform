import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportDocumentAuthorization} from '../src/supportDocumentAuthorization.js';

const tenantId='11700000-0000-4000-8000-000000000001';
const actorId='11700000-0000-4000-8000-000000000011';
const eventId='11700000-0000-4000-8000-000000000021';
const requestId='11700000-0000-4000-8000-000000000041';
const matterId='11700000-0000-4000-8000-000000000031';
const documentRefHash='a'.repeat(64);
const input=phase=>({tenantId,actorId,eventId,expectedResultJobId:requestId,expectedResultHash:'b'.repeat(64),artifactHash:'c'.repeat(64),phase,operation:'REVIEW_DOCUMENT',signal:new AbortController().signal});
const binding=()=>({tenantId,actorId,eventId,requestId,matterId,documentRefHash});
const decision={active:true};

test('V168 invokes current durable DOCUMENT_READ lookup at every review document gate',async()=>{
  const phases=[],seen=[];
  const authorizer=createSupportDocumentAuthorization({
    authorizeDocument:async ({phase})=>{phases.push(phase);return true;},
    resolveBinding:async()=>binding(),
    readCurrentGrant:async grant=>{seen.push(grant);return decision;}
  });
  for(const phase of ['RESOLVE','READ_VERSION','RELEASE'])assert.equal(await authorizer(input(phase)),true);
  assert.deepEqual(phases,['RESOLVE','READ_VERSION','RELEASE']);
  assert.equal(seen.length,3);
  for(const grant of seen)assert.deepEqual({...grant,signal:undefined},{...binding(),eventId:undefined,scope:'DOCUMENT_READ',signal:undefined});
});
test('V168 revoked or absent durable grant always denies and never invokes normal authorizer',async()=>{
  let normal=0;
  const authorizer=createSupportDocumentAuthorization({
    authorizeDocument:async()=>{normal++;return true;},
    resolveBinding:async()=>binding(),
    readCurrentGrant:async()=>{throw Error('DURABLE_SUPPORT_GRANT_UNAVAILABLE');}
  });
  await assert.rejects(authorizer(input('RELEASE')),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(normal,0);
});
test('V168 cross-actor trusted mapping is rejected before grant lookup',async()=>{
  let reads=0;
  const authorizer=createSupportDocumentAuthorization({
    authorizeDocument:async()=>true,
    resolveBinding:async()=>({...binding(),actorId:'11700000-0000-4000-8000-000000000013'}),
    readCurrentGrant:async()=>{reads++;return decision;}
  });
  await assert.rejects(authorizer(input('RESOLVE')),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(reads,0);
});
test('V168 normal document denial remains mandatory after a valid support grant',async()=>{
  const authorizer=createSupportDocumentAuthorization({
    authorizeDocument:async()=>false,
    resolveBinding:async()=>binding(),
    readCurrentGrant:async()=>decision
  });
  await assert.rejects(authorizer(input('RELEASE')),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
});
test('V168 accessors cannot forge authorization fields',async()=>{
  const authorizer=createSupportDocumentAuthorization({
    authorizeDocument:async()=>true,
    resolveBinding:async()=>binding(),
    readCurrentGrant:async()=>decision
  });
  const forged=input('RESOLVE');
  Object.defineProperty(forged,'tenantId',{get(){throw Error('getter executed')},enumerable:true});
  await assert.rejects(authorizer(forged),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
});
