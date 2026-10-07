import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from './store.js';
import { MockProclaimAdapter } from './adapters.js';
import { LegalOpsService } from './service.js';

export const seed={matters:[
  {id:'m_a1',tenantId:'tenant-a',displayReference:'A-1001',externalRefs:['CLM-70001','MAT-1001'],proclaimId:'P-A-1001'},
  {id:'m_a2',tenantId:'tenant-a',displayReference:'A-1002',externalRefs:['CLM-70002','MAT-1002'],proclaimId:'P-A-1002'},
  {id:'m_b1',tenantId:'tenant-b',displayReference:'B-2001',externalRefs:['CLM-90001','MAT-2001'],proclaimId:'P-B-2001'}
]};

export function createApp() {
  const store=new MemoryStore(seed);
  const proclaim=new MockProclaimAdapter();
  const service=new LegalOpsService({store,proclaim});

  const server=http.createServer(async (req,res)=>{
    const send=(status,payload)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload));};
    try {
      const url=new URL(req.url,'http://localhost');
      if (url.pathname==='/health') return send(200,{status:'ok'});
      if (url.pathname==='/__test/reset' && req.method==='POST') { store.reset(seed); proclaim.history=[]; return send(200,{ok:true}); }
      const tenantId=req.headers['x-tenant-id'];
      if (!tenantId) return send(401,{error:'TENANT_REQUIRED'});
      const readBody=()=>new Promise((resolve,reject)=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch(e){reject(Object.assign(e,{status:400}));}});});

      const matterMatch=url.pathname.match(/^\/api\/v1\/matters\/([^/]+)$/);
      if (matterMatch && req.method==='GET') {
        const m=store.getMatter(tenantId,matterMatch[1]);
        return m?send(200,m):send(404,{error:'NOT_FOUND'});
      }
      if (url.pathname==='/api/v1/inbound-events' && req.method==='POST') {
        const body=await readBody(); const out=service.ingest(tenantId,body,req.headers['idempotency-key']); return send(202,out);
      }
      if (url.pathname==='/api/v1/exceptions' && req.method==='GET') return send(200,{items:service.listExceptions(tenantId)});
      const exc=url.pathname.match(/^\/api\/v1\/exceptions\/([^/]+)\/resolve$/);
      if (exc && req.method==='POST') { const b=await readBody(); const out=service.resolveException(tenantId,exc[1],b.resolution,b.matterId); return out?send(200,out):send(404,{error:'NOT_FOUND'}); }
      if (url.pathname==='/api/v1/integrations/proclaim/writebacks' && req.method==='POST') { const b=await readBody(); const out=await service.writeback(tenantId,b,req.headers['idempotency-key']); return send(202,out); }
      if (url.pathname==='/api/v1/audit' && req.method==='GET') return send(200,{items:service.audits(tenantId)});
      return send(404,{error:'NOT_FOUND'});
    } catch (e) {
      return send(e.status||500,{error:e.code||'INTERNAL_ERROR',message:e.status&&e.status<500?e.message:'Internal error'});
    }
  });
  return {server,store,proclaim,service};
}

if (import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {server}=createApp();
  const port=Number(process.env.PORT||3000);
  server.listen(port,()=>console.log(`reference API listening on ${port}`));
}
