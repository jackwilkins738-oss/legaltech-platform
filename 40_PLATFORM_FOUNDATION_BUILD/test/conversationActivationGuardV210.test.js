import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationActivationGuard} from '../src/conversationActivationGuard.js';

test('V210 remains disabled with no operational transaction',async()=>{
 const guard=new ConversationActivationGuard({transaction:async()=>({status:'DORMANT',tables:4})});
 await assert.rejects(()=>guard.createThread(),/CONVERSATION_ACTIVATION_DENIED/);
 await assert.rejects(()=>guard.sendMessage(),/CONVERSATION_ACTIVATION_DENIED/);
 await assert.rejects(()=>guard.changeParticipants(),/CONVERSATION_ACTIVATION_DENIED/);
});
