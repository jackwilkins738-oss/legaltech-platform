// Buffer ownership stays with ManagedReviewDocuments until this actual response
// finishes or closes. finish acknowledges the server write, not client receipt.
export function sendReviewDocument(res,document,traceId){
  return new Promise((resolve,reject)=>{
    if(res.destroyed||res.writableEnded||document.signal.aborted)return reject(Error('REVIEW_DOCUMENT_UNAVAILABLE'));
    let done=false;const finish=()=>complete(),close=()=>complete(Error('REVIEW_DOCUMENT_UNAVAILABLE')),error=()=>res.destroy();
    const abort=()=>res.destroy();
    function complete(failure){if(done)return;done=true;res.off('finish',finish);res.off('close',close);res.off('error',error);document.signal.removeEventListener('abort',abort);failure?reject(failure):resolve();}
    res.once('finish',finish);res.once('close',close);res.once('error',error);document.signal.addEventListener('abort',abort,{once:true});
    try{const extension={'application/pdf':'pdf','text/plain':'txt','application/json':'json'}[document.contentType];
      res.writeHead(200,{'content-type':document.contentType+(document.contentType==='application/pdf'?'':'; charset=utf-8'),'content-length':document.size,'content-disposition':`attachment; filename="review-${document.eventId}.${extension}"`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'x-trace-id':traceId,'x-content-sha256':document.artifactHash});res.end(document.bytes);
    }catch{res.destroy();}
  });
}
