import {createFencedReviewDocumentConsume} from './fencedReviewDocumentConsume.js';

/**
 * Opt-in HTTP response adapter. The supplied consumer must await response
 * completion; premature disconnects reject and never claim delivery success.
 * The caller must authenticate, authorize, audit, and validate document bytes.
 */
export function createFencedHttpDocumentResponder({resolveBinding,transferFence,liveSession}={}){
  const fenced=createFencedReviewDocumentConsume({resolveBinding,transferFence,liveSession});
  return async function deliver(context,document,response){
    if(!response||typeof response.writeHead!=='function'||typeof response.end!=='function'||
      typeof response.on!=='function'||typeof response.removeListener!=='function'||
      response.headersSent||response.writableEnded||response.destroyed)
      throw Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE');
    let closed=false;
    let transportFailed=false;
    // A peer can disconnect before writeHead/end. In that case ServerResponse
    // may not emit close until later; the underlying socket closes immediately.
    const socket=response.socket;
    const disconnected=()=>{if(!response.writableFinished)closed=true;};
    const failed=()=>{transportFailed=true;};
    response.on('error',failed);
    response.on('close',disconnected);
    if(socket)socket.on('close',disconnected);
    try{
      return await fenced(context,document,async verified=>{
        if(closed||transportFailed||socket?.destroyed||response.destroyed||response.headersSent)throw Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE');
        const bytes=verified.bytes;
        if(!Buffer.isBuffer(bytes)||bytes.length!==verified.size)throw Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE');
        const done=new Promise((resolve,reject)=>{
          let finished=false;
          const finish=()=>{finished=true;cleanup();resolve();};
          const close=()=>{cleanup();reject(Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE'));};
          const failure=()=>{cleanup();reject(Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE'));};
          const cleanup=()=>{response.removeListener('finish',finish);response.removeListener('close',close);response.removeListener('error',failure);};
          response.on('finish',finish);response.on('close',close);response.on('error',failure);
        });
        response.writeHead(200,{'content-type':verified.contentType,'content-length':verified.size,'cache-control':'no-store','x-content-type-options':'nosniff'});
        response.end(bytes);
        await done;
        if(closed||transportFailed||!response.writableFinished)throw Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE');
      });
    }catch{
      if(!response.writableEnded&&!response.destroyed&&typeof response.destroy==='function')response.destroy();
      throw Error('SUPPORT_HTTP_DOCUMENT_UNAVAILABLE');
    }finally{
      response.removeListener('close',disconnected);
      response.removeListener('error',failed);
      if(socket)socket.removeListener('close',disconnected);
    }
  };
}
