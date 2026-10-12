import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationDormantProbe} from '../src/conversationDormantProbe.js';
const names=['matter_conversation_threads','matter_conversation_participants','matter_conversation_messages','matter_conversation_audit'];
const rows=()=>names.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true,has_runtime_dml:false,has_restrictive_deny:true}));
test('V209 transaction probe verifies trusted result and binds only fixed table names',async()=>{
 const probe=new ConversationDormantProbe({read:async work=>work({query:async(sql,parameters)=>{
  assert.match(sql,/pg_catalog.pg_policy/);
  assert.deepEqual(parameters,[names]);
  return {rows:rows()};
 }})});
 assert.deepEqual(await probe.verify(),{status:'DORMANT',tables:4});
});
test('V209 transaction probe fails closed on permission drift or query errors',async()=>{
 for(const read of [
  async work=>work({query:async()=>({rows:rows().map((x,i)=>i===0?{...x,has_runtime_dml:true}:x)})}),
  async work=>work({query:async()=>({rows:[]})}),
  async work=>work({query:async()=>{throw Error('database unavailable')}}),
  async()=>({status:'ACTIVE',tables:4})
 ]){
  await assert.rejects(()=>new ConversationDormantProbe({read}).verify(),/CONVERSATION_ADMISSION_DENIED/);
 }
 assert.throws(()=>new ConversationDormantProbe(),/CONVERSATION_PROBE_CONFIGURATION_INVALID/);
});
