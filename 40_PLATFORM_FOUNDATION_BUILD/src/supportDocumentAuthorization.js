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
      const lookup=Object.freeze({tenantId:binding.tenantId,actorId:binding.actorId,requestId:binding.requestId,matterId:binding.matterId,scope:'DOCUMENT_READ',documentRefHash:binding.documentRefHash,signal:request.signal});
      // Do not treat an earlier grant read as authority after the separate
      // existing document-permission provider has awaited external work.
      const first=await readCurrentGrant(lookup);
      if(first?.active!==true||request.signal?.aborted)throw deny();
      const permitted=await authorizeDocument(Object.freeze({...request}));
      if(permitted!==true||request.signal?.aborted)throw deny();
      // A trusted server-side case/document binding can change while the
      // human/document permission provider is awaiting. Never release against
      // a stale mapping, even if the original grant remains active.
      const finalBinding=snapshot(await resolveBinding(Object.freeze({tenantId:request.tenantId,actorId:request.actorId,eventId:request.eventId,signal:request.signal})),['tenantId','actorId','eventId','requestId','matterId','documentRefHash']);
      if(Object.keys(binding).some(key=>binding[key]!==finalBinding[key])||request.signal?.aborted)throw deny();
      const last=await readCurrentGrant(lookup);
      if(last?.active!==true||request.signal?.aborted)throw deny();
      return true;
    }catch{throw deny();}
  };
}

/**
 * Optional final transfer wrapper. Revalidates immediately before entering
 * the consumer and after it completes. Does not make bytes already sent
 * retractable: production deployment still requires a transactional transfer
 * fence and transport cancellation on revocation.
 */
export function createSupportDocumentConsumeGate({authorizeRelease,consume}={}){
  if(typeof authorizeRelease!=='function'||typeof consume!=='function')throw new Error('SUPPORT_DOCUMENT_CONSUME_CONFIGURATION_INVALID');
  return async function gatedConsume(payload){
    try{
      const keys=['eventId','resultJobId','resultHash','artifactHash','contentType','size','bytes','signal'];
      const value=snapshot(payload,keys);
      if(value.signal?.aborted)throw deny();
      if(await authorizeRelease(Object.freeze({...value,phase:'RELEASE'}))!==true||value.signal?.aborted)throw deny();
      await consume(value);
      if(value.signal?.aborted)throw deny();
      // The canonical document authorization adapter accepts RELEASE,
      // not a distinct COMPLETE phase. Repeat the same live gate.
      if(await authorizeRelease(Object.freeze({...value,phase:'RELEASE'}))!==true||value.signal?.aborted)throw deny();
    }catch{throw deny();}
  };
}
