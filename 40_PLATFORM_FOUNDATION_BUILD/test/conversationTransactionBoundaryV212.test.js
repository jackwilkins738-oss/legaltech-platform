import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationTransactionBoundary} from '../src/conversationTransactionBoundary.js';
const id='11700000-0000-4000-8000-000000000001';
const command={kind:'POST',threadId:id,body:'Please review',requestId:'request-123'};
test('V212 authorization and audit occur inside exactly one transaction',async()=>{
 const sequence=[];
 const boundary=new ConversationTransactionBoundary({
  transaction:async (context,work)=>{sequence.push('begin');const result=await work({query:async()=>({rows:[]})});sequence.push('commit');return result;},
  authorize:async({command})=>{sequence.push('authorize');assert.equal(command.kind,'POST');return true;},
  commit:async()=>{sequence.push('write-and-audit');return {committed:true,audited:true};}
 });
 assert.deepEqual(await boundary.execute({command,session:{actorId:id,tenantId:id,sessionId:id}}),{committed:true,audited:true});
 assert.deepEqual(sequence,['begin','authorize','write-and-audit','commit']);
});
test('V212 cannot report a successful write without audit or permission',async()=>{
 for(const [authorized,result] of [[false,{committed:true,audited:true}],[true,{committed:true,audited:false}],[true,{committed:false,audited:true}]]){
  const boundary=new ConversationTransactionBoundary({
   transaction:async (context,work)=>work({query:async()=>({rows:[]})}),
   authorize:async()=>authorized,commit:async()=>result
  });
  await assert.rejects(()=>boundary.execute({command,session:{actorId:id,tenantId:id,sessionId:id}}),/CONVERSATION_TRANSACTION_DENIED/);
 }
});

test('V213 pins caller identity before the first async boundary',async()=>{
 const source={tenantId:id,actorId:id,sessionId:id};
 let seen;
 const boundary=new ConversationTransactionBoundary({
  transaction:async (context,work)=>{source.actorId='11700000-0000-4000-8000-000000000002';return work({query:async()=>({rows:[]})});},
  authorize:async({session})=>{seen=session;assert.equal(session.actorId,id);assert.ok(Object.isFrozen(session));return true;},
  commit:async({session})=>{assert.strictEqual(session,seen);return {committed:true,audited:true};}
 });
 await boundary.execute({command,session:source});
 const accessor=Object.defineProperty({tenantId:id,sessionId:id},'actorId',{enumerable:true,get(){throw Error('accessor invoked')}});
 await assert.rejects(()=>boundary.execute({command,session:accessor}),/CONVERSATION_TRANSACTION_DENIED/);
});

test('V214 binds immutable write transaction context to original session identity',async()=>{
 const input={tenantId:id,actorId:id,sessionId:id};
 let context;
 const boundary=new ConversationTransactionBoundary({
  transaction:async (pinned,work)=>{context=pinned;input.actorId='11700000-0000-4000-8000-000000000002';return work({query:async()=>({rows:[]})});},
  authorize:async({session})=>{assert.equal(session.actorId,id);return true;},
  commit:async()=>({committed:true,audited:true})
 });
 await boundary.execute({command,session:input});
 assert.deepEqual(context,{tenantId:id,actorId:id,readOnly:false});
 assert.equal(Object.isFrozen(context),true);
});
