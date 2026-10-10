// Explicit opt-in adapter for ManagedReviewDocuments.authorizeDocument.
// The caller supplies a server-trusted binding and a live PostgreSQL grant lookup.
// Normal review permissions remain mandatory: durable support access never replaces them.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny=()=>new Error('SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&UUID.test(a)&&UUID.test(b)&&a===b;
function snapshot(value,keys,required=keys){
  if(value===null||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw deny();
  const props=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).some(k=>!keys.includes(k))||required.some(k=>!props[k])||Reflect.ownKeys(value).some(k=>!Object.hasOwn(props[k]??{},'value')))throw deny();
  return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).map(k=>[k,props[k].value])));
}
/**
 * The binding must be resolved from trusted server-side case/matter mapping,
 * never from a request body. Caller retains responsibility for session proof.
 */
export function createSupportDocumentAuthorization({authorizeDocument,resolveBinding,readCurrentGrant}={}){
  if([authorizeDocument,resolveBinding,readCurrentGrant].some(f=>typeof f!=='function'))throw new Error('SUPPORT_DOCUMENT_AUTHORIZATION_CONFIGURATION_INVALID');
  return async function authorize(input){
    try{
      const request=snapshot(input,['tenantId','actorId','eventId','expectedResultJobId','expectedResultHash','artifactHash','phase','operation','signal','objectKey','versionId','size','contentType','evidenceHash','region','revision','state','malwareScan','parserIsolation'],['tenantId','actorId','eventId','phase','operation','signal']);
      if(request.operation!=='REVIEW_DOCUMENT'||!['RESOLVE','READ_VERSION','RELEASE'].includes(request.phase)||request.signal?.aborted)throw deny();
      const binding=snapshot(await resolveBinding(Object.freeze({tenantId:request.tenantId,actorId:request.actorId,eventId:request.eventId,signal:request.signal})),['tenantId','actorId','eventId','requestId','matterId','documentRefHash']);
      if(!same(binding.tenantId,request.tenantId)||!same(binding.actorId,request.actorId)||!same(binding.eventId,request.eventId)||!UUID.test(binding.requestId)||!UUID.test(binding.matterId)||!(/^[0-9a-f]{64}$/.test(binding.documentRefHash)))throw deny();
      const decision=await readCurrentGrant(Object.freeze({tenantId:binding.tenantId,actorId:binding.actorId,requestId:binding.requestId,matterId:binding.matterId,scope:'DOCUMENT_READ',documentRefHash:binding.documentRefHash,signal:request.signal}));
      if(decision?.active!==true||request.signal?.aborted)throw deny();
      const permitted=await authorizeDocument(input);
      if(permitted!==true||request.signal?.aborted)throw deny();
      return true;
    }catch{throw deny();}
  };
}
