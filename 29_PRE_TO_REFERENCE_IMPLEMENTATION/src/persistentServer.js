import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SQLiteStore } from './sqliteStore.js';
import { MockProclaimAdapter } from './adapters.js';
import { PersistentLegalOpsService } from './persistentService.js';

export const seed={matters:[
{id:'m_a1',tenantId:'tenant-a',displayReference:'A-1001',externalRefs:['CLM-70001','MAT-1001'],proclaimId:'P-A-1001'},
{id:'m_a2',tenantId:'tenant-a',displayReference:'A-1002',externalRefs:['CLM-70002','MAT-1002'],proclaimId:'P-A-1002'},
{id:'m_b1',tenantId:'tenant-b',displayReference:'B-2001',externalRefs:['CLM-90001','MAT-2001'],proclaimId:'P-B-2001'}]};

export function createPersistentApp({dbFile=':memory:'}={}) {
  const store=new SQLiteStore(dbFile,seed); const proclaim=new MockProclaimAdapter(); const service=new PersistentLegalOpsService({store,proclaim});
  const ui=fs.readFileSync(new URL('../ui/index.html',import.meta.url),'utf8');
  const server=http.createServer(async(req,res)=>{
    const send=(status,payload,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(payload):payload);};
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/'&&req.method==='GET') return send(200,ui,'text/html; charset=utf-8');
      if(url.pathname==='/health') return send(200,{status:'ok',persistence:'sqlite'});
      if(url.pathname==='/__test/reset'&&req.method==='POST'){store.reset(seed);proclaim.history=[];return send(200,{ok:true});}
      const tenantId=req.headers['x-tenant-id']; if(!tenantId)return send(401,{error:'TENANT_REQUIRED'});
      const readBody=()=>new Promise((resolve,reject)=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch(e){reject(Object.assign(e,{status:400,code:'INVALID_JSON'}));}});});
      const matter=url.pathname.match(/^\/api\/v1\/matters\/([^/]+)$/); if(matter&&req.method==='GET'){const m=store.getMatter(tenantId,matter[1]);return m?send(200,m):send(404,{error:'NOT_FOUND'});}
      if(url.pathname==='/api/v1/inbound-events'&&req.method==='POST'){const b=await readBody();return send(202,service.ingest(tenantId,b,req.headers['idempotency-key']));}
      if(url.pathname==='/api/v1/exceptions'&&req.method==='GET')return send(200,{items:service.listExceptions(tenantId)});
      const ex=url.pathname.match(/^\/api\/v1\/exceptions\/([^/]+)\/resolve$/);if(ex&&req.method==='POST'){const b=await readBody();const out=service.resolveException(tenantId,ex[1],b.resolution,b.matterId);return out?send(200,out):send(404,{error:'NOT_FOUND'});}
      if(url.pathname==='/api/v1/integrations/proclaim/writebacks'&&req.method==='POST'){const b=await readBody();return send(202,await service.writeback(tenantId,b,req.headers['idempotency-key']));}
      if(url.pathname==='/api/v1/audit'&&req.method==='GET')return send(200,{items:service.audits(tenantId)});
      if(url.pathname==='/api/v1/jobs'&&req.method==='GET')return send(200,{items:store.listJobs(tenantId)});
      if(url.pathname==='/api/v1/jobs'&&req.method==='POST'){const b=await readBody();return send(202,service.enqueue(tenantId,b.type,b.payload||{}));}
      return send(404,{error:'NOT_FOUND'});
    } catch(e){return send(e.status||500,{error:e.code||'INTERNAL_ERROR',message:e.status&&e.status<500?e.message:'Internal error'});}
  });
  return {server,store,proclaim,service,close:()=>store.close()};
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){const app=createPersistentApp({dbFile:process.env.DB_FILE||'./local-reference.db'});const port=Number(process.env.PORT||3000);app.server.listen(port,()=>console.log(`persistent reference API listening on ${port}`));}
