import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConversationStorageDormant,conversationStorageProofSql} from '../src/conversationStorageProof.js';

const tables=['matter_conversation_threads','matter_conversation_participants','matter_conversation_messages','matter_conversation_audit'];
const valid=()=>tables.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true,has_runtime_dml:false,has_restrictive_deny:true}));

test('V208 accepts only four distinct dormant tables with a restrictive false guard',()=>{
 assert.deepEqual(assertConversationStorageDormant(valid()),{status:'DORMANT',tables:4});
 for(const field of ['relrowsecurity','relforcerowsecurity','has_restrictive_deny']){
  const rows=valid();rows[0][field]=false;
  assert.throws(()=>assertConversationStorageDormant(rows),/CONVERSATION_ADMISSION_DENIED/);
 }
 const granted=valid();granted[0].has_runtime_dml=true;
 assert.throws(()=>assertConversationStorageDormant(granted),/CONVERSATION_ADMISSION_DENIED/);
 const duplicate=valid();duplicate[1].relname=duplicate[0].relname;
 assert.throws(()=>assertConversationStorageDormant(duplicate),/CONVERSATION_ADMISSION_DENIED/);
 assert.throws(()=>assertConversationStorageDormant(valid().slice(1)),/CONVERSATION_ADMISSION_DENIED/);
 assert.match(conversationStorageProofSql,/pg_get_expr/);
 assert.match(conversationStorageProofSql,/has_table_privilege/);
});
