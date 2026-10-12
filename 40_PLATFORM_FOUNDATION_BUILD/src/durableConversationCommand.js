// Trusted server-side input contract for the eventual durable conversation writer.
// This module never authorizes a user or writes to a database.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid=()=>new Error('CONVERSATION_COMMAND_INVALID');
const uuid=value=>typeof value==='string'&&UUID.test(value);
const plain=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
const pick=(input,allowed,required)=>{
 if(!plain(input)||Reflect.ownKeys(input).some(key=>!allowed.includes(key)))throw invalid();
 const out={};
 for(const key of allowed){
  const descriptor=Object.getOwnPropertyDescriptor(input,key);
  if(!descriptor){if(required.includes(key))throw invalid();continue;}
  if(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw invalid();
  out[key]=descriptor.value;
 }
 return out;
};
const bounded=(x,min,max)=>typeof x==='string'&&x.length>=min&&x.length<=max&&x.trim().length>0&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
const ids=value=>{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>24||
 Object.keys(value).length!==value.length||value.some(x=>!uuid(x))||
 new Set(value).size!==value.length)throw invalid();
 return Object.freeze([...value.map(x=>x.toLowerCase())]);
};
export function pinConversationCommand(input){
 const {kind}=pick(input,['kind','matterId','threadId','subject','participantIds','body','requestId','expectedRevision'],['kind']);
 if(kind==='CREATE'){
  const c=pick(input,['kind','matterId','subject','participantIds'],['kind','matterId','subject','participantIds']);
  if(!uuid(c.matterId)||!bounded(c.subject,1,200))throw invalid();
  return Object.freeze({kind,matterId:c.matterId.toLowerCase(),subject:c.subject,participantIds:ids(c.participantIds)});
 }
 if(kind==='POST'){
  const c=pick(input,['kind','threadId','body','requestId'],['kind','threadId','body','requestId']);
  if(!uuid(c.threadId)||!bounded(c.body,1,4000)||!bounded(c.requestId,8,200))throw invalid();
  return Object.freeze({kind,threadId:c.threadId.toLowerCase(),body:c.body,requestId:c.requestId});
 }
 if(kind==='PARTICIPANTS'){
  const c=pick(input,['kind','threadId','participantIds','expectedRevision'],['kind','threadId','participantIds','expectedRevision']);
  if(!uuid(c.threadId)||!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<1)throw invalid();
  return Object.freeze({kind,threadId:c.threadId.toLowerCase(),participantIds:ids(c.participantIds),expectedRevision:c.expectedRevision});
 }
 throw invalid();
}
