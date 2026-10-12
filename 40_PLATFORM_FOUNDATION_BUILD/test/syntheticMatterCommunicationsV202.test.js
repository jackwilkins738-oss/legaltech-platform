import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntheticMatterCommunications} from '../src/syntheticMatterCommunications.js';
const matters=[{id:'m1',tenantId:'a',visibility:'STANDARD'},{id:'m2',tenantId:'a',visibility:'PRIVATE'},{id:'m3',tenantId:'b',visibility:'STANDARD'}];
const store={getMatter:(tenantId,id)=>matters.find(m=>m.tenantId===tenantId&&m.id===id)};
const session=(actorId='alice',more={})=>({actorId,tenantId:'a',roles:[],capabilities:['matter:communicate','matter:communicate:read'],...more});
test('V202 matter conversations require explicit participants, tenant and matter access',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Request for evidence',participantIds:['bob']}});
 assert.deepEqual(t.participantIds,['bob','alice']);
 assert.equal(c.listThreads({session:session('bob'),matterId:'m1'}).length,1);
 assert.equal(c.listThreads({session:session('eve'),matterId:'m1'}).length,0);
 assert.throws(()=>c.messages({session:session('eve'),threadId:t.id}),{code:'NOT_FOUND'});
 assert.throws(()=>c.post({session:session('eve'),threadId:t.id,body:'forged'}),{code:'NOT_FOUND'});
 assert.throws(()=>c.post({session:session('bob',{tenantId:'b'}),threadId:t.id,body:'forged'}),{code:'NOT_FOUND'});
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m2',subject:'Restricted',participantIds:[]}}),{code:'NOT_FOUND'});
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m3',subject:'Wrong tenant',participantIds:[]}}),{code:'NOT_FOUND'});
});
test('V202 messages are isolated, bounded and capability-controlled',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Status',participantIds:['bob']}});
 c.post({session:session('bob'),threadId:t.id,body:'Ready for review'});
 assert.equal(c.messages({session:session(),threadId:t.id})[0].body,'Ready for review');
 assert.throws(()=>c.post({session:session('bob',{capabilities:['matter:communicate:read']}),threadId:t.id,body:'blocked'}),{code:'NOT_FOUND'});
 assert.throws(()=>c.messages({session:session('bob',{capabilities:['matter:communicate']}),threadId:t.id}),{code:'NOT_FOUND'});
 assert.throws(()=>c.post({session:session(),threadId:t.id,body:''}),{code:'INVALID_REQUEST'});
 assert.throws(()=>c.messages({session:session(),threadId:t.id,limit:201}),{code:'INVALID_REQUEST'});
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m1',subject:'Bad',participantIds:[],extra:true}}),{code:'INVALID_REQUEST'});
});
test('V202 membership withdrawal denies previously accessible conversation',()=>{
 const m={id:'m4',tenantId:'a',visibility:'PRIVATE'};
 const c=new SyntheticMatterCommunications({matterStore:{getMatter:(t,id)=>id==='m4'&&t==='a'?m:null}});
 const granted=session('alice',{matterMembershipIds:['m4']});
 const thread=c.createThread({session:granted,input:{matterId:'m4',subject:'Private',participantIds:[]}});
 assert.throws(()=>c.messages({session:session(),threadId:thread.id}),{code:'NOT_FOUND'});
 assert.equal(c.messages({session:granted,threadId:thread.id}).length,0);
});
