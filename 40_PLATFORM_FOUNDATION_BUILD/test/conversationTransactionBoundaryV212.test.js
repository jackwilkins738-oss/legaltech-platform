import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationTransactionBoundary} from '../src/conversationTransactionBoundary.js';
const id='11700000-0000-4000-8000-000000000001';
const command={kind:'POST',threadId:id,body:'Please review',requestId:'request-123'};
test('V212 authorization and audit occur inside exactly one transaction',async()=>{
 const sequence=[];
 const boundary=new ConversationTransactionBoundary({
  transaction:async work=>{sequence.push('begin');const result=await work({query:async()=>({rows:[]})});sequence.push('commit');return result;},
  authorize:async({command})=>{sequence.push('authorize');assert.equal(command.kind,'POST');return true;},
  commit:async()=>{sequence.push('write-and-audit');return {committed:true,audited:true};}
 });
 assert.deepEqual(await boundary.execute({command,session:{actorId:id}}),{committed:true,audited:true});
 assert.deepEqual(sequence,['begin','authorize','write-and-audit','commit']);
});
test('V212 cannot report a successful write without audit or permission',async()=>{
 for(const [authorized,result] of [[false,{committed:true,audited:true}],[true,{committed:true,audited:false}],[true,{committed:false,audited:true}]]){
  const boundary=new ConversationTransactionBoundary({
   transaction:async work=>work({query:async()=>({rows:[]})}),
   authorize:async()=>authorized,commit:async()=>result
  });
  await assert.rejects(()=>boundary.execute({command,session:{actorId:id}}),/CONVERSATION_TRANSACTION_DENIED/);
 }
});
