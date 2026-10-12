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

test('V202 creator can revoke a participant immediately but cannot be removed',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Handover',participantIds:['bob','eve']}});
 c.post({session:session('bob'),threadId:t.id,body:'Before revocation'});
 assert.throws(()=>c.replaceParticipants({session:session('bob'),threadId:t.id,participantIds:['bob']}),{code:'NOT_FOUND'});
 const updated=c.replaceParticipants({session:session(),threadId:t.id,participantIds:['eve']});
 assert.deepEqual(updated.participantIds,['eve','alice']);
 assert.throws(()=>c.messages({session:session('bob'),threadId:t.id}),{code:'NOT_FOUND'});
 assert.throws(()=>c.post({session:session('bob'),threadId:t.id,body:'After revocation'}),{code:'NOT_FOUND'});
 assert.equal(c.listThreads({session:session('bob'),matterId:'m1'}).length,0);
 assert.equal(c.messages({session:session('eve'),threadId:t.id}).length,1);
});
test('V202 bounded storage fails closed without dropping existing messages',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store,maxThreads:1,maxMessages:1});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Bounded',participantIds:[]}});
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m1',subject:'Extra',participantIds:[]}}),{code:'COMMUNICATION_CAPACITY'});
 c.post({session:session(),threadId:t.id,body:'First'});
 assert.throws(()=>c.post({session:session(),threadId:t.id,body:'Second'}),{code:'COMMUNICATION_CAPACITY'});
 assert.equal(c.messages({session:session(),threadId:t.id}).length,1);
});

test('V202 snapshot observes coherent messages and revocation revision',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Updates',participantIds:['bob']}});
 const initial=c.snapshot({session:session('bob'),threadId:t.id});
 assert.equal(initial.revision,1);
 assert.equal(initial.messages.length,0);
 c.post({session:session(),threadId:t.id,body:'First'});
 const updated=c.snapshot({session:session('bob'),threadId:t.id});
 assert.equal(updated.revision,2);
 assert.equal(updated.messages.length,1);
 c.replaceParticipants({session:session(),threadId:t.id,participantIds:[]});
 assert.throws(()=>c.snapshot({session:session('bob'),threadId:t.id}),{code:'NOT_FOUND'});
 const remaining=c.snapshot({session:session(),threadId:t.id});
 assert.equal(remaining.revision,3);
 assert.deepEqual(remaining.thread.participantIds,['alice']);
 assert.throws(()=>c.snapshot({session:session(),threadId:t.id,limit:0}),{code:'INVALID_REQUEST'});
});

test('V202 audit emits bounded metadata without message bodies and is creator-only',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Test',participantIds:['bob']}});
 c.post({session:session('bob'),threadId:t.id,body:'Sensitive information not for audit'});
 c.replaceParticipants({session:session(),threadId:t.id,participantIds:[]});
 const entries=c.audit({session:session(),threadId:t.id});
 assert.deepEqual(entries.map(e=>e.kind),['CREATED','MESSAGE_POSTED','PARTICIPANTS_CHANGED']);
 assert.deepEqual(entries.map(e=>e.revision),[1,2,3]);
 assert.equal(JSON.stringify(entries).includes('Sensitive information'),false);
 assert.throws(()=>c.audit({session:session('bob'),threadId:t.id}),{code:'NOT_FOUND'});
 assert.equal(c.audit({session:session(),threadId:t.id,limit:1}).length,1);
});

test('V202 participant ceiling includes automatically-added creator',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const twentyFive=Array.from({length:25},(_,i)=>'participant-'+i);
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m1',subject:'Too many',participantIds:twentyFive}}),{code:'INVALID_REQUEST'});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Acceptable',participantIds:twentyFive.slice(0,24)}});
 assert.equal(t.participantIds.length,25);
 assert.throws(()=>c.replaceParticipants({session:session(),threadId:t.id,participantIds:twentyFive}),{code:'INVALID_REQUEST'});
 assert.equal(c.snapshot({session:session(),threadId:t.id}).thread.participantIds.length,25);
});

test('V202 invalid clock leaves participant membership and revision unchanged',()=>{
 let broken=false;
 const c=new SyntheticMatterCommunications({matterStore:store,now:()=>broken?'not-a-date':'2026-10-12T00:00:00.000Z'});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Review',participantIds:['bob']}});
 broken=true;
 assert.throws(()=>c.replaceParticipants({session:session(),threadId:t.id,participantIds:[]}),/COMMUNICATION_CLOCK_INVALID/);
 broken=false;
 const snapshot=c.snapshot({session:session('bob'),threadId:t.id});
 assert.equal(snapshot.revision,1);
 assert.deepEqual(snapshot.thread.participantIds,['bob','alice']);
 assert.equal(c.audit({session:session(),threadId:t.id}).length,1);
});

test('V202 sparse and decorated participant arrays are refused before mutation',()=>{
 const c=new SyntheticMatterCommunications({matterStore:store});
 const sparse=new Array(2);sparse[0]='bob';
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m1',subject:'Sparse',participantIds:sparse}}),{code:'INVALID_REQUEST'});
 const decorated=['bob'];decorated.extra='eve';
 assert.throws(()=>c.createThread({session:session(),input:{matterId:'m1',subject:'Decorated',participantIds:decorated}}),{code:'INVALID_REQUEST'});
 const t=c.createThread({session:session(),input:{matterId:'m1',subject:'Valid',participantIds:['bob']}});
 assert.throws(()=>c.replaceParticipants({session:session(),threadId:t.id,participantIds:sparse}),{code:'INVALID_REQUEST'});
 assert.throws(()=>c.replaceParticipants({session:session(),threadId:t.id,participantIds:decorated}),{code:'INVALID_REQUEST'});
 assert.equal(c.snapshot({session:session(),threadId:t.id}).revision,1);
});
