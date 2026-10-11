import {pinSupportFields} from './supportAuthorityInput.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const unavailable=()=>new Error('SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE');

/**
 * Opt-in bridge from a trusted server-side document binding to the durable
 * PostgreSQL transfer fence. Actual byte consumption executes while the
 * transaction/advisory lock is held. Do not take this binding from an HTTP body.
 */
export function createFencedSupportDocumentConsumer({resolveBinding,transferFence,consume,liveSession}={}){
  if([resolveBinding,transferFence,consume].some(fn=>typeof fn!=='function'))throw new Error('SUPPORT_DOCUMENT_TRANSFER_CONFIGURATION_INVALID');
  if(liveSession!==undefined&&typeof liveSession?.assertCurrent!=='function')throw new Error('SUPPORT_DOCUMENT_TRANSFER_CONFIGURATION_INVALID');
  return async function deliver(context,payload){
    try{
      const identity=pinSupportFields(context,['tenantId','actorId','eventId'],['signal'],unavailable);
      const document=pinSupportFields(payload,['eventId','resultJobId','resultHash','artifactHash','contentType','size','bytes'],['signal'],unavailable);
      if(![identity.tenantId,identity.actorId,identity.eventId,document.eventId,document.resultJobId].every(x=>typeof x==='string'&&UUID.test(x))||
        identity.eventId!==document.eventId||!HASH.test(document.resultHash)||!HASH.test(document.artifactHash)||
        !Buffer.isBuffer(document.bytes)||!Number.isSafeInteger(document.size)||document.size<1||
        document.size!==document.bytes.length||identity.signal?.aborted||document.signal?.aborted)throw unavailable();
      if(liveSession&&await liveSession.assertCurrent(Object.freeze({...identity}))!==true)throw unavailable();
      const mapping=pinSupportFields(await resolveBinding(Object.freeze({...identity})),
        ['tenantId','actorId','eventId','requestId','matterId','documentRefHash'],[],unavailable);
      if(mapping.tenantId!==identity.tenantId||mapping.actorId!==identity.actorId||
        mapping.eventId!==identity.eventId||!UUID.test(mapping.requestId)||!UUID.test(mapping.matterId)||
        !HASH.test(mapping.documentRefHash)||identity.signal?.aborted||document.signal?.aborted)throw unavailable();
      const grant={tenantId:mapping.tenantId,actorId:mapping.actorId,requestId:mapping.requestId,
        matterId:mapping.matterId,scope:'DOCUMENT_READ',documentRefHash:mapping.documentRefHash,signal:identity.signal};
      return await transferFence(Object.freeze(grant),async()=>{
        const latest=pinSupportFields(await resolveBinding(Object.freeze({...identity})),
          ['tenantId','actorId','eventId','requestId','matterId','documentRefHash'],[],unavailable);
        if(Object.keys(mapping).some(key=>mapping[key]!==latest[key])||identity.signal?.aborted||document.signal?.aborted)throw unavailable();
        if(liveSession&&await liveSession.assertCurrent(Object.freeze({...identity}))!==true)throw unavailable();
        const result=await consume(Object.freeze({...document}),Object.freeze({...identity}));
        if(liveSession&&await liveSession.assertCurrent(Object.freeze({...identity}))!==true)throw unavailable();
        return result;
      });
    }catch{throw unavailable();}
  };
}
