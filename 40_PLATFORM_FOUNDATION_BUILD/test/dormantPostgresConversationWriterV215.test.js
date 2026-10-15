import test from 'node:test';
import assert from 'node:assert/strict';
import {DormantPostgresConversationWriter} from '../src/dormantPostgresConversationWriter.js';

const tenant='11700000-0000-4000-8000-000000000001';
const alice='11700000-0000-4000-8000-000000000011';
const bob='11700000-0000-4000-8000-000000000012';
const matter='11700000-0000-4000-8000-000000000021';
const session={tenantId:tenant,actorId:alice,sessionId:'11700000-0000-4000-8000-000000000031'};
const commands={
 create:{kind:'CREATE',matterId:matter,subject:'Matter review',participantIds:[bob]},
 post:threadId=>({kind:'POST',threadId,body:'Please review this evidence',requestId:'request-001'}),
 participants:threadId=>({kind:'PARTICIPANTS',threadId,participantIds:[],expectedRevision:2})
};
// A transaction spy models the SQL result shape; it is NOT a real database.
function fixture({permit=true,failAudit=false}={}){
 const calls=[];
 const threadId='11700000-0000-4000-8000-000000000041';
 let revision=1;
 let participants=new Set([alice,bob]);
 let stored=null;
 let audited=0;
 const tx={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('FROM public.matter_conversation_threads')&&sql.includes('FOR UPDATE'))
   return {rows:[{id:threadId,matter_id:matter,creator_actor_id:alice,revision}]};
  if(sql.includes('FROM public.matter_conversation_participants')&&sql.includes('revoked_at IS NULL')){
   if(sql.includes('actor_id=$3'))return {rows:participants.has(args[2])?[{actor_id:args[2]}]:[]};
   return {rows:[...participants].map(actor_id=>({actor_id}))};
  }
  if(sql.startsWith('SELECT id,body FROM public.matter_conversation_messages'))
   return {rows:stored?[stored]:[]};
  if(sql.startsWith('INSERT INTO public.matter_conversation_threads'))return {rows:[{id:args[0]}]};
  if(sql.startsWith('INSERT INTO public.matter_conversation_participants')){
   participants.add(args[2]);return {rows:[{actor_id:args[2]}]};
  }
  if(sql.startsWith('UPDATE public.matter_conversation_participants')){
   participants.delete(args[2]);return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO public.matter_conversation_messages')){
   stored={id:args[0],body:args[5]};return {rows:[{id:args[0]}]};
  }
  if(sql.startsWith('UPDATE public.matter_conversation_threads')){
   if(args[2]!==revision)return {rows:[]};
   revision++;return {rows:[{revision}]};
  }
  if(sql.startsWith('INSERT INTO public.matter_conversation_audit')){
   if(failAudit)return {rows:[]};
   audited++;return {rows:[{revision:args[3]??1}]};
  }
  throw Error('UNEXPECTED_SQL');
 }};
 const writer=new DormantPostgresConversationWriter({
  transact:async(context,work)=>{
   assert.deepEqual(context,{tenantId:tenant,actorId:alice,readOnly:false});
   return work(tx);
  },
  authorize:async(context)=>{calls.push({authorization:context.kind,recipients:context.participantIds});return permit;}
 });
 return {writer,calls,threadId,get revision(){return revision;},get audited(){return audited;},get participants(){return participants;}};
}

test('V215 create persists thread, memberships and metadata-only evidence in one write transaction',async()=>{
 const f=fixture();
 const result=await f.writer.execute({session,command:commands.create});
 assert.equal(result.kind,'CREATED');
 assert.equal(result.revision,1);
 assert.equal(f.audited,1);
 assert.ok(f.calls.find(x=>x.authorization==='CREATE'&&x.recipients?.includes(bob)));
 assert.equal(f.calls.filter(x=>x.sql?.startsWith('INSERT INTO public.matter_conversation_participants')).length,2);
 assert.ok(f.calls.find(x=>x.sql?.includes("'CREATED'")));
});
test('V215 post serializes with revocation, deduplicates retry and advances audited revision',async()=>{
 const f=fixture();
 const command=commands.post(f.threadId);
 const first=await f.writer.execute({session,command});
 assert.equal(first.replayed,false);
 assert.equal(first.revision,2);
 assert.equal(f.audited,1);
 const replay=await f.writer.execute({session,command});
 assert.equal(replay.replayed,true);
 assert.equal(f.audited,1);
 assert.equal(f.calls.filter(x=>x.sql?.includes('FOR UPDATE')).length,2);
 assert.equal(f.calls.filter(x=>x.sql?.startsWith('INSERT INTO public.matter_conversation_messages')).length,1);
 assert.ok(f.calls.find(x=>x.sql?.includes("'MESSAGE_POSTED'")));
 await assert.rejects(()=>f.writer.execute({session,command:{...command,body:'Changed payload'}}),/DURABLE_CONVERSATION_DENIED/);
});
test('V215 membership change serializes under thread lock and revokes removed participants',async()=>{
 const f=fixture();
 await f.writer.execute({session,command:commands.post(f.threadId)});
 const result=await f.writer.execute({session,command:commands.participants(f.threadId)});
 assert.equal(result.revision,3);
 assert.equal(result.participantCount,1);
 assert.deepEqual([...f.participants],[alice]);
 assert.ok(f.calls.find(x=>x.sql?.includes("'PARTICIPANTS_CHANGED'")));
 await assert.rejects(()=>f.writer.execute({session,command:commands.participants(f.threadId)}),/DURABLE_CONVERSATION_DENIED/);
});
test('V215 denies writes without live authorization and rejects missing audit evidence',async()=>{
 const no=fixture({permit:false});
 await assert.rejects(()=>no.writer.execute({session,command:commands.post(no.threadId)}),/DURABLE_CONVERSATION_DENIED/);
 assert.equal(no.calls.some(x=>x.sql?.startsWith('INSERT INTO public.matter_conversation_messages')),false);
 const fail=fixture({failAudit:true});
 await assert.rejects(()=>fail.writer.execute({session,command:commands.post(fail.threadId)}),/DURABLE_CONVERSATION_DENIED/);
 assert.throws(()=>new DormantPostgresConversationWriter(),/DURABLE_CONVERSATION_CONFIGURATION_INVALID/);
});
