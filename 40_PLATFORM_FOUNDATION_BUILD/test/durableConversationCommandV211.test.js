import test from 'node:test';
import assert from 'node:assert/strict';
import {pinConversationCommand} from '../src/durableConversationCommand.js';
const a='11700000-0000-4000-8000-000000000001';
const b='11700000-0000-4000-8000-000000000002';
test('V211 pins canonical immutable create, post, participant commands',()=>{
 const create=pinConversationCommand({kind:'CREATE',matterId:a,subject:'Review evidence',participantIds:[b]});
 assert.equal(create.matterId,a);assert.ok(Object.isFrozen(create));assert.ok(Object.isFrozen(create.participantIds));
 assert.equal(pinConversationCommand({kind:'POST',threadId:a,body:'Please advise',requestId:'request-123'}).kind,'POST');
 assert.equal(pinConversationCommand({kind:'PARTICIPANTS',threadId:a,participantIds:[b],expectedRevision:2}).expectedRevision,2);
});
test('V211 denies tenant impersonation, malformed parameters, accessor values and stale revisions',()=>{
 const valid={kind:'POST',threadId:a,body:'Review',requestId:'request-123'};
 const accessor=Object.defineProperty({...valid},'threadId',{get(){return a;},enumerable:true});
 for(const input of [
  {...valid,tenantId:b},{...valid,actorId:b},{...valid,extra:true},
  {...valid,requestId:'x'}, {...valid,body:''},{...valid,threadId:'not-uuid'},accessor,
  {kind:'PARTICIPANTS',threadId:a,participantIds:[b],expectedRevision:0},
  {kind:'PARTICIPANTS',threadId:a,participantIds:[b,b],expectedRevision:1},
  {kind:'CREATE',matterId:a,subject:'Bad',participantIds:new Array(1)},
  {kind:'CREATE',matterId:a,subject:'Bad',participantIds:Array(25).fill(b)}
 ])assert.throws(()=>pinConversationCommand(input),/CONVERSATION_COMMAND_INVALID/);
});
