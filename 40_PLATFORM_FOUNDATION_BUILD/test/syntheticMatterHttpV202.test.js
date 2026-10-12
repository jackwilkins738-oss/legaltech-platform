import test from 'node:test';
import assert from 'node:assert/strict';
import {PlatformStore} from '../src/store.js';
import {Platform} from '../src/platform.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';
import {SyntheticMatterCommunications} from '../src/syntheticMatterCommunications.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

test('V202 synthetic API provides authorized matter conversations and denies unauthenticated or wrong-tenant access',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v202-http-'));
 const store=new PlatformStore(path.join(dir,'db'),{matters:[{id:'m-a',tenantId:'a',externalId:'A'},{id:'m-b',tenantId:'b',externalId:'B'}]});
 const platform=new Platform({store,objectStorage:new LocalObjectStorage(path.join(dir,'objects')),aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});
 const authProvider=new StaticAuthProvider([
  {token:'alice-token',actorId:'alice',tenantId:'a',capabilities:['matter:communicate','matter:communicate:read']},
  {token:'bob-token',actorId:'bob',tenantId:'a',capabilities:['matter:communicate','matter:communicate:read']},
  {token:'other-token',actorId:'charlie',tenantId:'b',capabilities:['matter:communicate','matter:communicate:read']}
 ]);
 const server=createApiServer({platform,authProvider,syntheticCommunications:new SyntheticMatterCommunications({matterStore:store})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/dev/conversations';
 const request=(token,route='',method='GET',body)=>fetch(url+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const created=await request('alice-token','','POST',{matterId:'m-a',subject:'Evidence',participantIds:['bob']});
  assert.equal(created.status,201);
  const thread=(await created.json()).thread;
  assert.equal((await request('bob-token','?matter_id=m-a')).status,200);
  assert.equal((await request('other-token','/'+thread.id+'/messages')).status,404);
  assert.equal((await fetch(url+'/'+thread.id+'/messages')).status,401);
  const sent=await request('bob-token','/'+thread.id+'/messages','POST',{body:'Please review'});
  assert.equal(sent.status,201);
  const idempotent=await request('bob-token','/'+thread.id+'/messages','POST',{body:'Idempotent message',requestId:'message-1'});
  assert.equal(idempotent.status,201);
  const repeated=await request('bob-token','/'+thread.id+'/messages','POST',{body:'Idempotent message',requestId:'message-1'});
  assert.equal(repeated.status,201);
  assert.equal((await idempotent.json()).message.id,(await repeated.json()).message.id);
  assert.equal((await request('bob-token','/'+thread.id+'/messages','POST',{body:'Changed',requestId:'message-1'})).status,409);
  assert.equal((await request('alice-token','/'+thread.id+'/participants','PUT',{participantIds:['bob'],expectedRevision:1})).status,409);

  const messages=await request('alice-token','/'+thread.id+'/messages');
  assert.equal((await messages.json()).messages[0].body,'Please review');
  assert.equal((await request('alice-token','/'+thread.id+'/participants','PUT',{participantIds:[]})).status,200);
  assert.equal((await request('bob-token','/'+thread.id+'/snapshot')).status,404);
  assert.equal((await request('alice-token','/'+thread.id+'/snapshot')).status,200);
  const audit=await request('alice-token','/'+thread.id+'/audit');
  assert.equal(audit.status,200);
  const entries=(await audit.json()).events;
  assert.deepEqual(entries.map(x=>x.kind),['CREATED','MESSAGE_POSTED','PARTICIPANTS_CHANGED']);
  assert.equal(JSON.stringify(entries).includes('Please review'),false);
  assert.equal((await request('bob-token','/'+thread.id+'/audit')).status,404);
  assert.equal((await request('other-token','/'+thread.id+'/audit')).status,404);
  assert.equal((await request('alice-token','/'+thread.id+'/audit?limit=0')).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('V202 synthetic communication adapter is forbidden in production before accepting requests',()=>{
 assert.throws(()=>createApiServer({productionMode:true,syntheticCommunications:{}}),/PRODUCTION_REFERENCE_ADAPTER_FORBIDDEN/);
});
