import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationActivationGuard} from '../src/conversationActivationGuard.js';

test('V210 remains disabled with no operational transaction',async()=>{
 const guard=new ConversationActivationGuard({transaction:async()=>({status:'DORMANT',tables:4})});
 await assert.rejects(()=>guard.createThread(),/CONVERSATION_ACTIVATION_DENIED/);
 await assert.rejects(()=>guard.sendMessage(),/CONVERSATION_ACTIVATION_DENIED/);
 await assert.rejects(()=>guard.changeParticipants(),/CONVERSATION_ACTIVATION_DENIED/);
});

test('V210 refuses invalid security catalogue even if transaction callback succeeds',async()=>{
 const names=['matter_conversation_threads','matter_conversation_participants','matter_conversation_messages','matter_conversation_audit'];
 const correct=names.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true,has_runtime_dml:false,has_restrictive_deny:true}));
 for(const changed of [
  correct.slice(1),
  correct.map((row,i)=>i===0?{...row,has_runtime_dml:true}:row),
  correct.map((row,i)=>i===0?{...row,has_restrictive_deny:false}:row),
  correct.map((row,i)=>i===0?{...row,relforcerowsecurity:false}:row)
 ]){
  const guard=new ConversationActivationGuard({transaction:async work=>work({query:async()=>({rows:changed})})});
  await assert.rejects(()=>guard.assertDisabled(),/CONVERSATION_ACTIVATION_DENIED/);
 }
 const valid=new ConversationActivationGuard({transaction:async work=>work({query:async()=>({rows:correct})})});
 assert.deepEqual(await valid.assertDisabled(),{productionMessagingEnabled:false,storageStatus:'DORMANT'});
});
